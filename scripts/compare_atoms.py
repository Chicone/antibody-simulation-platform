def atom_keys(path):
    keys = []
    with open(path) as f:
        for line in f:
            if line.startswith("ATOM"):
                atom = line[12:16].strip()
                res = line[17:20].strip()
                chain = line[21].strip()
                resid = line[22:26].strip()
                keys.append((chain, resid, res, atom))
    return keys

old = set(atom_keys("data/processed/1N8Z_fab.pdb"))
new = set(atom_keys("data/processed/1N8Z_fab_repaired.pdb"))

print("Added:")
for x in sorted(new - old):
    print(x)

print("\nRemoved:")
for x in sorted(old - new):
    print(x)