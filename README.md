# AbMD

AbMD is a reproducible workflow for all-atom molecular dynamics simulations of therapeutic antibodies, with the longer-term goal of extracting structural and dynamic features for biologics developability prediction using graph neural networks.

## Project goals

The project aims to build a clean, reproducible, and scalable workflow for:

* preparing antibody structures for all-atom molecular dynamics
* running GROMACS simulations
* performing standard structural and dynamical analyses
* extracting residue-level MD-derived features
* exporting antibody structures and trajectory-derived representations for later GNN experiments
* scaling simulations to multiple antibodies and replicas on HPC systems

A later stage may include comparison with Martini coarse-grained simulations and integration into a graphical dashboard.

## Current priority

The initial focus is the all-atom MD workflow.

The first validation system will be the trastuzumab Fab from PDB **1N8Z**, using only the antibody heavy and light chains.

Initial workflow:

```text
structure preparation
        ↓
simulation box
        ↓
solvation
        ↓
ion addition
        ↓
energy minimization
        ↓
NVT equilibration
        ↓
NPT equilibration
        ↓
production MD
        ↓
trajectory analysis
```

## Design principles

* scientific correctness first
* reproducibility
* explicit provenance of simulation parameters and input structures
* configuration-driven workflows
* command-line operation before GUI development
* scalable design for multiple antibodies and replicas
* separation between raw input data, workflow code, simulation outputs, and analysis results

## Status

Early development.

Current milestone:

**Prepare and simulate one trastuzumab Fab system reproducibly with GROMACS.**
