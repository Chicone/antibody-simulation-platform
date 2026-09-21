from __future__ import annotations

import subprocess
import json
import shutil
from pathlib import Path
import os
import shutil

# Use MARTINIZE2 env var if provided, otherwise search PATH.
MARTINIZE2 = os.environ.get("MARTINIZE2") or shutil.which("martinize2")

MARTINI_FF = os.environ.get("MARTINI_FF")

if not MARTINI_FF:
    raise RuntimeError(
        "MARTINI_FF is not set. "
        "Point it to the Martini 3 force-field directory."
    )

MARTINI_FF = Path(MARTINI_FF)

if not MARTINIZE2:
    raise RuntimeError(
        "martinize2 not found. "
        "Install it or set the MARTINIZE2 environment variable."
    )

def patch_system_topology(
    system_top: Path,
    system_gro: Path,
    martini_ff: Path,
    model: str = "elastic",
) -> None:
    """Patch INSANE output for Martini 3 and martinize2."""

    lines = system_top.read_text(
        encoding="utf-8"
    ).splitlines()

    patched = []

    for line in lines:
        stripped = line.strip()

        # Remove INSANE's legacy generic Martini include.
        if (
            stripped.startswith("#include")
            and "martini.itp" in stripped
        ):
            continue

        # Fix Martini 3 ion names.
        line = line.replace("NA+", "NA")
        line = line.replace("CL-", "CL")

        patched.append(line)

    # GōMartini emits a single Protein.itp containing both chains, whereas
    # the existing EN workflow emits Protein_*.itp per chain.
    if model == "go":
        required = ("Protein.itp", "go_atomtypes.itp", "go_nbparams.itp")
        missing = [name for name in required if not (system_top.parent / name).is_file()]
        if missing:
            raise RuntimeError(f"Incomplete GōMartini topology: {missing}")
        include_block = [
            "#define GO_VIRT",
            f'#include "{martini_ff / "martini_v3.0.0.itp"}"',
            '#include "go_atomtypes.itp"',
            '#include "go_nbparams.itp"',
            f'#include "{martini_ff / "martini_v3.0.0_solvents_v1.itp"}"',
            f'#include "{martini_ff / "martini_v3.0.0_ions_v1.itp"}"',
            '#include "Protein.itp"',
            "",
        ]
        # INSANE's `Protein 1` is already correct for this topology.
        patched = include_block + patched
    elif model == "elastic":
        protein_itps = sorted(system_top.parent.glob("Protein_*.itp"))
        if not protein_itps:
            raise RuntimeError("No Protein_*.itp files produced by martinize2.")
        include_block = [
            f'#include "{martini_ff / "martini_v3.0.0.itp"}"',
            f'#include "{martini_ff / "martini_v3.0.0_solvents_v1.itp"}"',
            f'#include "{martini_ff / "martini_v3.0.0_ions_v1.itp"}"',
        ]
        for protein_itp in protein_itps:
            include_block.append(f'#include "{protein_itp.name}"')
        include_block.append("")
        patched = include_block + patched

        # INSANE's generic Protein entry must match the per-chain EN types.
        in_molecules = False
        new_patched = []
        for line in patched:
            stripped = line.strip()
            if stripped.lower() == "[ molecules ]":
                in_molecules = True
                new_patched.append(line)
                continue
            if in_molecules and stripped.startswith("["):
                in_molecules = False
            if in_molecules and stripped.startswith("Protein "):
                for protein_itp in protein_itps:
                    new_patched.append(f"{protein_itp.stem:<16} 1")
                continue
            new_patched.append(line)
        patched = new_patched
    else:
        raise ValueError(f"Unsupported Martini model: {model}")

    system_top.write_text(
        "\n".join(patched) + "\n",
        encoding="utf-8",
    )

    # Match ion names in the coordinate file too.
    gro = system_gro.read_text(
        encoding="utf-8",
        errors="replace",
    )

    gro = gro.replace("NA+", "NA ")
    gro = gro.replace("CL-", "CL ")

    system_gro.write_text(
        gro,
        encoding="utf-8",
    )

def prepare_martini_input(src: Path, dst: Path) -> None:
    """Create a clean protein PDB suitable for martinize2."""

    lines = []

    for line in src.read_text(encoding="utf-8").splitlines():

        # Preserve chain boundaries.
        if line.startswith("TER"):
            lines.append(line)
            continue

        if not line.startswith("ATOM"):
            continue

        element = (
            line[76:78].strip().upper()
            if len(line) >= 78
            else ""
        )

        atom_name = line[12:16].strip().upper()

        # Remove explicit hydrogens.
        if element == "H" or atom_name.startswith("H"):
            continue

        # Vermouth can fail when explicit OXT is present;
        # martinize2 reconstructs the C-terminal modification itself.
        if atom_name == "OXT":
            continue

        lines.append(line)

    lines.append("END")

    dst.write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
    )

def run_command(
    cmd: list[str],
    cwd: Path,
    log_file: Path,
    input_text: str | None = None,
) -> None:
    """Run a Martini/GROMACS command and stream output to the live terminal."""

    job_dir = log_file.parent
    pid_file = job_dir / "current_process.json"
    stop_file = job_dir / "stop.requested"

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("\n$ " + " ".join(map(str, cmd)) + "\n")
        log.flush()

        process = subprocess.Popen(
            [str(x) for x in cmd],
            cwd=str(cwd),
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            stdin=subprocess.PIPE if input_text is not None else None,
            text=True,
        )

        if input_text is not None and process.stdin is not None:
            process.stdin.write(input_text)
            process.stdin.flush()
            process.stdin.close()

        # Expose the active process so the Stop button can terminate it.
        pid_file.write_text(
            json.dumps({"pid": process.pid}),
            encoding="utf-8",
        )

        process.wait()

        pid_file.unlink(missing_ok=True)

        if stop_file.exists():
            raise RuntimeError("JOB_STOPPED")

        if process.returncode != 0:
            raise RuntimeError(
                f"Command failed with exit code "
                f"{process.returncode}: {' '.join(cmd)}"
            )

def run_martini_pipeline(job_dir: Path) -> None:
    """Prepare one Martini antibody simulation job."""

    # ---------------------------------------------------------
    # 1. Locate this job's files
    # ---------------------------------------------------------

    input_dir = job_dir / "input"
    out_dir = job_dir / "out"
    log_file = job_dir / "log.txt"

    protein_file = input_dir / "protein.pdb"
    params_file = input_dir / "params.json"

    if not protein_file.exists():
        raise FileNotFoundError(
            f"Input PDB not found: {protein_file}"
        )

    if not params_file.exists():
        raise FileNotFoundError(
            f"Job parameters not found: {params_file}"
        )

    # ---------------------------------------------------------
    # 2. Read Martini settings from the dashboard
    # ---------------------------------------------------------

    params = json.loads(
        params_file.read_text(encoding="utf-8")
    )

    duration_ns = float(params["duration_ns"])
    model = params.get("model", "elastic")
    if model not in {"elastic", "go"}:
        raise ValueError(f"Unsupported Martini model: {model!r}")
    go_epsilon = float(params.get("go_epsilon", 9.414))
    go_lower = float(params.get("go_lower", 0.3))
    go_upper = float(params.get("go_upper", 1.1))
    if model == "go" and not (go_epsilon > 0 and 0 < go_lower < go_upper):
        raise ValueError("Gō parameters require epsilon > 0 and 0 < lower < upper")
    elastic_force = float(params.get("elastic_force") or 250)
    elastic_lower = float(params.get("elastic_lower") or 0.5)
    elastic_upper = float(params.get("elastic_upper") or 0.7)
    salt_concentration = float(
        params.get("salt_concentration", 0.15)
    )
    temperature = float(
        params.get("temperature", 310.0)
    )
    nt = int(params.get("nt", 8))

    # ---------------------------------------------------------
    # 3. Prepare this run's isolated workspace
    # ---------------------------------------------------------

    out_dir.mkdir(parents=True, exist_ok=True)

    shutil.copy2(
        protein_file,
        out_dir / "protein.pdb",
    )

    # ---------------------------------------------------------
    # 4. Record the Martini configuration
    # ---------------------------------------------------------

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("\n=== MARTINI PIPELINE ===\n")
        log.write(f"Input structure : {protein_file.name}\n")
        log.write(f"Model           : {model}\n")
        log.write(f"Production      : {duration_ns} ns\n")
        log.write(f"Temperature     : {temperature} K\n")
        log.write(f"NaCl            : {salt_concentration} M\n")
        log.write(f"CPU threads     : {nt}\n")

        if model == "elastic":
            log.write(f"EN force        : {elastic_force}\n")
            log.write(f"EN lower cutoff : {elastic_lower} nm\n")
            log.write(f"EN upper cutoff : {elastic_upper} nm\n")

        if model == "go":
            log.write(f"Go epsilon      : {go_epsilon} kJ/mol\n")
            log.write(f"Go lower cutoff : {go_lower} nm\n")
            log.write(f"Go upper cutoff : {go_upper} nm\n")
        log.write("Martini workspace prepared successfully.\n")

    # ---------------------------------------------------------
    # 5. Prepare a clean structure for Martini
    # ---------------------------------------------------------

    # Martini needs canonical protein heavy atoms, not the fully
    # protonated all-atom structure used by the CHARMM workflow.
    martini_input = out_dir / "protein_martini.pdb"

    prepare_martini_input(
        out_dir / "protein.pdb",
        martini_input,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Martini protein input cleaned successfully.\n")

    # ---------------------------------------------------------
    # 6. Convert the antibody from all-atom to Martini 3
    # ---------------------------------------------------------

    cg_pdb = out_dir / "Protein_cg.pdb"
    protein_top = out_dir / "Protein.top"

    command = [
        MARTINIZE2,
        "-f", str(martini_input),
        "-x", str(cg_pdb),
        "-o", str(protein_top),
        "-ff", "martini3001",
    ]

    # Elastic-network model selected in the dashboard.
    if model == "elastic":
        command.extend(
            [
                "-elastic",
                "-ef", str(elastic_force),
                "-el", str(elastic_lower),
                "-eu", str(elastic_upper),
            ]
        )

    elif model == "go":
        command.extend([
            "-go", "-go-write-file",
            "-go-eps", str(go_epsilon),
            "-go-low", str(go_lower),
            "-go-up", str(go_upper),
        ])

    command.extend(
        [
            "-name", "Protein",
            "-p", "backbone",
            "-pf", "1000",
            "-maxwarn", "30",
        ]
    )

    run_command(
        command,
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("martinize2 completed successfully.\n")

    # ---------------------------------------------------------
    # 7. Solvate the Martini Fab and add ions
    # ---------------------------------------------------------

    system_gro = out_dir / "system.gro"
    system_top = out_dir / "system.top"

    run_command(
        [
            "insane",
            "-f", str(cg_pdb),
            "-o", str(system_gro),
            "-p", str(system_top),
            "-sol", "W",
            "-salt", str(salt_concentration),
            "-d", "1.2",
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Martini solvation and ion placement completed successfully.\n")

    # ---------------------------------------------------------
    # 8. Patch the Martini 3 topology generated by INSANE
    # ---------------------------------------------------------

    patch_system_topology(
        system_top,
        system_gro,
        MARTINI_FF,
        model=model,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Martini system topology patched successfully.\n")

    # ---------------------------------------------------------
    # 9. Martini energy minimization
    # ---------------------------------------------------------

    em_mdp = (Path(__file__).resolve().parents[3]
            / "mdp"
            / "martini"
            / "em.mdp"
    )
    em_tpr = out_dir / "em.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(em_mdp),
            "-c", str(system_gro),
            "-p", str(system_top),
            "-o", str(em_tpr),
            "-maxwarn", "1",
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    run_command(
        [
            "gmx",
            "mdrun",
            "-deffnm", "em",
            "-nt", str(nt),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Martini energy minimization completed successfully.\n")

    # ---------------------------------------------------------
    # 10. Build index groups for equilibration
    # ---------------------------------------------------------

    index_ndx = out_dir / "index.ndx"

    make_ndx_input = (
        "name 11 Solvent\n"
        "q\n"
    )

    run_command(
        [
            "gmx",
            "make_ndx",
            "-f", str(out_dir / "em.gro"),
            "-o", str(index_ndx),
        ],
        cwd=out_dir,
        log_file=log_file,
        input_text=make_ndx_input,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Martini index groups created successfully.\n")

    # ---------------------------------------------------------
    # 11. Martini NVT equilibration
    # ---------------------------------------------------------

    nvt_mdp = (
            Path(__file__).resolve().parents[3]
            / "mdp"
            / "martini"
            / "nvt.mdp"
    )

    nvt_tpr = out_dir / "nvt.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(nvt_mdp),
            "-c", str(out_dir / "em.gro"),
            "-r", str(out_dir / "em.gro"),
            "-p", str(system_top),
            "-n", str(index_ndx),
            "-o", str(nvt_tpr),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    run_command(
        [
            "gmx",
            "mdrun",
            "-deffnm", "nvt",
            "-nt", str(nt),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Martini NVT equilibration completed successfully.\n")

    # ---------------------------------------------------------
    # 12. Martini NPT equilibration
    # ---------------------------------------------------------


    npt_mdp = (
            Path(__file__).resolve().parents[3]
            / "mdp"
            / "martini"
            / "npt.mdp"
    )

    npt_tpr = out_dir / "npt.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(npt_mdp),
            "-c", str(out_dir / "nvt.gro"),
            "-t", str(out_dir / "nvt.cpt"),
            "-p", str(system_top),
            "-n", str(index_ndx),
            "-o", str(npt_tpr),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    run_command(
        [
            "gmx",
            "mdrun",
            "-deffnm", "npt",
            "-nt", str(nt),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Martini NPT equilibration completed successfully.\n")

    # ---------------------------------------------------------
    # 13. Martini production MD
    # ---------------------------------------------------------

    production_template = (
            Path(__file__).resolve().parents[3]
            / "mdp"
            / "martini"
            / "production.mdp"
    )

    production_mdp = out_dir / "production.mdp"

    shutil.copy2(
        production_template,
        production_mdp,
    )

    # dt = 0.01 ps = 10 fs
    # therefore 1 ns = 100000 steps
    production_steps = int(duration_ns * 100000)

    lines = production_mdp.read_text(
        encoding="utf-8"
    ).splitlines()

    updated = []

    for line in lines:
        if line.strip().startswith("nsteps"):
            updated.append(f"nsteps = {production_steps}")
        else:
            updated.append(line)

    production_mdp.write_text(
        "\n".join(updated) + "\n",
        encoding="utf-8",
    )

    production_tpr = out_dir / "production.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(production_mdp),
            "-c", str(out_dir / "npt.gro"),
            "-t", str(out_dir / "npt.cpt"),
            "-p", str(system_top),
            "-n", str(index_ndx),
            "-o", str(production_tpr),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    run_command(
        [
            "gmx",
            "mdrun",
            "-deffnm", "production",
            "-nt", str(nt),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write(
            f"Martini production MD completed successfully: "
            f"{duration_ns} ns.\n"
        )
