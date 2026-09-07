from pdbfixer import PDBFixer
from openmm.app import PDBFile

input_pdb = "data/processed/1N8Z_fab.pdb"
output_pdb = "data/processed/1N8Z_fab_repaired.pdb"

fixer = PDBFixer(filename=input_pdb)

fixer.findMissingResidues()
fixer.findMissingAtoms()
fixer.addMissingAtoms()

with open(output_pdb, "w") as f:
    PDBFile.writeFile(fixer.topology, fixer.positions, f)

print(f"Wrote repaired structure to: {output_pdb}")