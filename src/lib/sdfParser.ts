import { Residue } from './pdbParser';

export const ATOM_MASS: Record<string, number> = {
  H: 1.01, C: 12.01, N: 14.01, O: 16.00, P: 30.97, S: 32.06,
  F: 19.00, CL: 35.45, BR: 79.90, I: 126.90
};

export function parseSDF(sdfText: string): Residue[] {
  const lines = sdfText.split(/\r?\n/);
  const residues: Residue[] = [];
  
  // Find the counts line (usually line 4, index 3)
  // Standard V2000 format: aaabbblllfffcccsssrrrppp...
  // aaa = number of atoms, bbb = number of bonds
  const countsLine = lines[3];
  if (!countsLine) return [];
  
  // Use regex to find the first two numbers in the counts line
  // Some SDFs might not strictly follow the 3-character spacing
  const countsMatch = countsLine.trim().match(/^(\d+)\s+(\d+)/);
  let numAtoms = 0;
  
  if (countsMatch) {
    numAtoms = parseInt(countsMatch[1], 10);
  } else {
    // Fallback to substring if regex fails
    numAtoms = parseInt(countsLine.substring(0, 3).trim(), 10);
  }
  
  if (isNaN(numAtoms) || numAtoms <= 0) return [];
  
  // Atom block starts at line 5 (index 4)
  for (let i = 0; i < numAtoms; i++) {
    const line = lines[4 + i];
    if (!line) break;
    
    // Standard V2000 Atom Line:
    // xxxxx.xxxxxyyyyy.yyyyyzzzzz.zzzzz aaattt...
    // x, y, z are 10 chars each
    const x = parseFloat(line.substring(0, 10).trim());
    const y = parseFloat(line.substring(10, 20).trim());
    const z = parseFloat(line.substring(20, 30).trim());
    
    // Atom symbol is at index 31 (3rd char after z)
    // But let's be more flexible
    const parts = line.trim().split(/\s+/);
    // Usually: [x, y, z, symbol, ...]
    // But x,y,z might be joined if they are large
    
    let atomSymbol = '';
    if (parts.length >= 4) {
      // If split works well
      atomSymbol = parts[3];
    } else {
      // Fallback to substring
      atomSymbol = line.substring(31, 34).trim();
    }
    
    if (!atomSymbol) continue;
    
    const mass = ATOM_MASS[atomSymbol.toUpperCase()] || 12.01; // Default to Carbon
    
    residues.push({
      resName: atomSymbol,
      resSeq: i + 1,
      chainID: 'A',
      x: isNaN(x) ? 0 : x,
      y: isNaN(y) ? 0 : y,
      z: isNaN(z) ? 0 : z,
      bFactor: 20,
      secStruct: 'coil',
      mass
    });
  }
  
  return residues;
}
