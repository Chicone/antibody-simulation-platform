from __future__ import annotations

import os
import signal
import json
import shutil
import subprocess
from pathlib import Path

def set_mdp_temperature(path: Path, temperature: float) -> None:
    """Set thermostat target and initial velocity temperature."""

    lines = path.read_text(encoding="utf-8").splitlines()
    updated = []

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("ref_t"):
            updated.append(f"ref_t = {temperature} {temperature}")

        elif stripped.startswith("gen_temp"):
            updated.append(f"gen_temp = {temperature}")

        else:
            updated.append(line)

    path.write_text(
        "\n".join(updated) + "\n",
        encoding="utf-8",
    )

def run_command(
    cmd: list[str],
    cwd: Path,
    log_file: Path,
    stdin_text: str | None = None,
) -> None:
    """Run one command, stream its output, and expose its PID for stopping."""

    job_dir = log_file.parent
    pid_file = job_dir / "current_process.json"
    stop_file = job_dir / "stop.requested"

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("\n$ " + " ".join(map(str, cmd)) + "\n")
        log.flush()

        # Start each GROMACS command in its own process group.
        process = subprocess.Popen(
            [str(x) for x in cmd],
            cwd=str(cwd),
            stdin=subprocess.PIPE if stdin_text is not None else None,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )

        # Let the job service know which process is currently running.
        pid_file.write_text(
            json.dumps({"pid": process.pid}),
            encoding="utf-8",
        )

        process.communicate(stdin_text)

        # This command is no longer active.
        pid_file.unlink(missing_ok=True)

        # A non-zero exit after Stop was requested is intentional.
        if stop_file.exists():
            raise RuntimeError("JOB_STOPPED")

        if process.returncode != 0:
            raise RuntimeError(
                f"Command failed with exit code "
                f"{process.returncode}: {' '.join(cmd)}"
            )

def run_aa_pipeline(job_dir: Path) -> None:
    """
    Execute the all-atom MD workflow for one dashboard job.

    At this stage we only prepare the job workspace.
    The GROMACS stages will be added next.
    """

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
    # 2. Read the simulation configuration
    # ---------------------------------------------------------

    params = json.loads(
        params_file.read_text(encoding="utf-8")
    )

    duration_ns = float(params["duration_ns"])
    nt = int(params.get("nt", 6))

    # Salt concentration selected in the dashboard.
    salt_concentration = float(
        params.get("salt_concentration", 0.15)
    )

    # Temperature selected in the dashboard.
    temperature = float(
        params.get("temperature", 310.0)
    )

    # ---------------------------------------------------------
    # 3. Find the original validated ABMD project
    # ---------------------------------------------------------

    # aa_pipeline.py:
    # antibody_dashboard/backend/pipelines/aa_pipeline.py
    #
    # parents[3]:
    # abmd/
    abmd_root = Path(__file__).resolve().parents[3]

    mdp_source = abmd_root / "mdp"

    if not mdp_source.exists():
        raise FileNotFoundError(
            f"ABMD MDP directory not found: {mdp_source}"
        )

    # ---------------------------------------------------------
    # 4. Prepare this run's isolated workspace
    # ---------------------------------------------------------

    out_dir.mkdir(parents=True, exist_ok=True)

    shutil.copy2(
        protein_file,
        out_dir / "protein.pdb",
    )

    mdp_files = [
        "ions.mdp",
        "em.mdp",
        "nvt.mdp",
        "npt.mdp",
        "unrestrained.mdp",
        "production.mdp",
    ]

    for filename in mdp_files:
        source = mdp_source / filename

        if not source.exists():
            raise FileNotFoundError(
                f"Required MDP file not found: {source}"
            )

        shutil.copy2(
            source,
            out_dir / filename,
        )

    # Apply the dashboard temperature to the thermostatted MD stages.
    for filename in [
        "nvt.mdp",
        "npt.mdp",
        "unrestrained.mdp",
        "production.mdp",
    ]:
        set_mdp_temperature(
            out_dir / filename,
            temperature,
        )

    # ---------------------------------------------------------
    # 5. Record the simulation configuration
    # ---------------------------------------------------------

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("\n=== ALL-ATOM PIPELINE ===\n")
        log.write(f"Input structure : {protein_file.name}\n")
        log.write(f"Production      : {duration_ns} ns\n")
        log.write(f"CPU threads     : {nt}\n")
        log.write(f"Workspace       : {out_dir}\n")
        log.write("MDP files copied successfully.\n")

    # ---------------------------------------------------------
    # 6. Generate the all-atom topology
    # ---------------------------------------------------------

    # Convert the uploaded Fab PDB into a GROMACS structure and topology.
    processed_gro = out_dir / "processed.gro"
    topology_top = out_dir / "topol.top"

    run_command(
        [
            "gmx",
            "pdb2gmx",
            "-f", str(out_dir / "protein.pdb"),
            "-o", str(processed_gro),
            "-p", str(topology_top),
            "-ff", "charmm36-feb2026_cgenff-5.0",
            "-water", "tip3p",
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("pdb2gmx completed successfully.\n")

    # ---------------------------------------------------------
    # 7. Create the simulation box
    # ---------------------------------------------------------

    # Center the Fab in a dodecahedral box with 1.0 nm padding.
    boxed_gro = out_dir / "boxed.gro"

    run_command(
        [
            "gmx",
            "editconf",
            "-f", str(processed_gro),
            "-o", str(boxed_gro),
            "-c",
            "-d", "1.0",
            "-bt", "dodecahedron",
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Simulation box created successfully.\n")

    # ---------------------------------------------------------
    # 8. Solvate the Fab
    # ---------------------------------------------------------

    # Fill the simulation box with TIP3P-compatible water.
    solvated_gro = out_dir / "solvated.gro"

    run_command(
        [
            "gmx",
            "solvate",
            "-cp", str(boxed_gro),
            "-cs", "spc216.gro",
            "-o", str(solvated_gro),
            "-p", str(topology_top),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Solvation completed successfully.\n")

    # ---------------------------------------------------------
    # 9. Add ions
    # ---------------------------------------------------------

    # Build a temporary TPR used only for ion placement.
    ions_tpr = out_dir / "ions.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(out_dir / "ions.mdp"),
            "-c", str(solvated_gro),
            "-p", str(topology_top),
            "-o", str(ions_tpr),
            "-maxwarn", "1",
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    # Replace water with ions to neutralize the system and reach the selected NaCl concentration.
    ionized_gro = out_dir / "ionized.gro"

    run_command(
        [
            "gmx",
            "genion",
            "-s", str(ions_tpr),
            "-o", str(ionized_gro),
            "-p", str(topology_top),
            "-pname", "NA",
            "-nname", "CL",
            "-neutral",
            "-conc", str(salt_concentration),
        ],
        cwd=out_dir,
        log_file=log_file,
        stdin_text="SOL\n",
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Ions added successfully.\n")

    # ---------------------------------------------------------
    # 10. Energy minimization
    # ---------------------------------------------------------

    # Build the minimization input from the ionized system.
    em_tpr = out_dir / "em.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(out_dir / "em.mdp"),
            "-c", str(ionized_gro),
            "-p", str(topology_top),
            "-o", str(em_tpr),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    # Relax bad contacts before equilibration.
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
        log.write("Energy minimization completed successfully.\n")

    # ---------------------------------------------------------
    # 11. NVT equilibration
    # ---------------------------------------------------------

    # Build the NVT input from the energy-minimized structure.
    nvt_tpr = out_dir / "nvt.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(out_dir / "nvt.mdp"),
            "-c", str(out_dir / "em.gro"),
            "-r", str(out_dir / "em.gro"),
            "-p", str(topology_top),
            "-o", str(nvt_tpr),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    # Equilibrate the system at the dashboard-selected temperature.
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
        log.write("NVT equilibration completed successfully.\n")

    # ---------------------------------------------------------
    # 12. NPT equilibration
    # ---------------------------------------------------------

    # Build the NPT input from the NVT-equilibrated structure.
    npt_tpr = out_dir / "npt.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(out_dir / "npt.mdp"),
            "-c", str(out_dir / "nvt.gro"),
            "-r", str(out_dir / "nvt.gro"),
            "-t", str(out_dir / "nvt.cpt"),
            "-p", str(topology_top),
            "-o", str(npt_tpr),
            "-maxwarn", "1",
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    # Equilibrate pressure while keeping the protein restrained.
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
        log.write("NPT equilibration completed successfully.\n")


    # ---------------------------------------------------------
    # 13. Unrestrained equilibration
    # ---------------------------------------------------------

    # Remove position restraints and let the Fab relax freely.
    unrestrained_tpr = out_dir / "unrestrained.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(out_dir / "unrestrained.mdp"),
            "-c", str(out_dir / "npt.gro"),
            "-t", str(out_dir / "npt.cpt"),
            "-p", str(topology_top),
            "-o", str(unrestrained_tpr),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    run_command(
        [
            "gmx",
            "mdrun",
            "-deffnm", "unrestrained",
            "-nt", str(nt),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    with open(log_file, "a", encoding="utf-8") as log:
        log.write("Unrestrained equilibration completed successfully.\n")


    # ---------------------------------------------------------
    # 14. Production MD
    # ---------------------------------------------------------

    production_mdp = out_dir / "production.mdp"

    # Convert the dashboard duration into the required number of MD steps.
    # dt = 0.002 ps, so 1 ns = 500000 steps.
    production_steps = int(duration_ns * 500000)

    # Update nsteps in this run's production MDP only.
    lines = production_mdp.read_text(encoding="utf-8").splitlines()
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

    # Build production input from the equilibrated system.
    production_tpr = out_dir / "production.tpr"

    run_command(
        [
            "gmx",
            "grompp",
            "-f", str(production_mdp),
            "-c", str(out_dir / "unrestrained.gro"),
            "-t", str(out_dir / "unrestrained.cpt"),
            "-p", str(topology_top),
            "-o", str(production_tpr),
        ],
        cwd=out_dir,
        log_file=log_file,
    )

    # Run the production trajectory requested in the dashboard.
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
            f"Production MD completed successfully: {duration_ns} ns.\n"
        )

    return

    return
