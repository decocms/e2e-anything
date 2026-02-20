#!/usr/bin/env bun

const KNOWN_SECTIONS = [
  'Checkout', 'PdP', 'Carrinho', 'Login', 'Meus pedidos', 
  'Meus dados', 'Minha conta', 'Pdp', 'PdP/Carrinho'
];

const VALID_LOGIN_STATES = ['Sim', 'Não', 'Sim e não'];

interface CSVRow {
  'Página/seção': string;
  'Erro': string;
  'Logado?': string;
  'Tester': string;
  'Observações': string;
}

interface ValidationError {
  row: number;
  message: string;
}

interface ValidationResult {
  totalRows: number;
  bugRows: number;
  subRows: number;
  emptyRows: number;
  resolvedCount: number;
  pendingCount: number;
  errors: ValidationError[];
}

function parseCSV(content: string): CSVRow[] {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows: CSVRow[] = [];
  let currentLine = '';
  let inQuotes = false;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    currentLine += (currentLine ? '\n' : '') + line;
    
    let quoteCount = 0;
    for (const char of line) {
      if (char === '"') quoteCount++;
    }
    inQuotes = quoteCount % 2 === 1;
    
    if (!inQuotes) {
      const values = parseCSVLine(currentLine);
      const row: any = {};
      
      headers.forEach((header, index) => {
        row[header] = (values[index] || '').trim();
      });
      
      rows.push(row as CSVRow);
      currentLine = '';
    }
  }
  
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  
  result.push(current);
  return result;
}

function isEmptyRow(row: CSVRow): boolean {
  return !row['Página/seção'] && !row['Erro'] && !row['Logado?'] && !row['Tester'] && !row['Observações'];
}

function isSubRow(row: CSVRow): boolean {
  return !row['Página/seção'] && (row['Erro'].startsWith('http') || (!row['Erro'] && row['Tester']));
}

function isResolved(row: CSVRow): boolean {
  const obs = row['Observações'].toLowerCase();
  return obs.includes('resolvido') || obs.includes('ajustado');
}

function validateCSV(rows: CSVRow[]): ValidationResult {
  const errors: ValidationError[] = [];
  let bugRows = 0;
  let subRows = 0;
  let emptyRows = 0;
  let resolvedCount = 0;
  let pendingCount = 0;
  let lastParentRowIndex = -1;
  
  rows.forEach((row, index) => {
    const rowNum = index + 2;
    
    if (isEmptyRow(row)) {
      emptyRows++;
      return;
    }
    
    if (isSubRow(row)) {
      subRows++;
      if (lastParentRowIndex === -1) {
        errors.push({
          row: rowNum,
          message: 'Sub-row found without a parent row above it'
        });
      }
      return;
    }
    
    if (!row['Erro']) {
      errors.push({
        row: rowNum,
        message: 'Non-empty row must have Erro filled'
      });
      return;
    }
    
    bugRows++;
    lastParentRowIndex = index;
    
    if (row['Página/seção'] && !KNOWN_SECTIONS.includes(row['Página/seção'])) {
      errors.push({
        row: rowNum,
        message: `Unknown section: "${row['Página/seção']}". Known sections: ${KNOWN_SECTIONS.join(', ')}`
      });
    }
    
    if (row['Logado?'] && !VALID_LOGIN_STATES.includes(row['Logado?'])) {
      errors.push({
        row: rowNum,
        message: `Invalid login state: "${row['Logado?']}". Valid values: ${VALID_LOGIN_STATES.join(', ')}`
      });
    }
    
    if (isResolved(row)) {
      resolvedCount++;
    } else {
      pendingCount++;
    }
  });
  
  return {
    totalRows: rows.length,
    bugRows,
    subRows,
    emptyRows,
    resolvedCount,
    pendingCount,
    errors
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: bun run validate-csv.ts <path-to-csv>');
    process.exit(1);
  }
  
  const csvPath = args[0];
  
  try {
    const file = Bun.file(csvPath);
    const content = await file.text();
    
    const rows = parseCSV(content);
    const result = validateCSV(rows);
    
    console.log('CSV Validation Summary:');
    console.log(`Total rows: ${result.totalRows}`);
    console.log(`Bug rows: ${result.bugRows}`);
    console.log(`Sub-rows: ${result.subRows}`);
    console.log(`Empty rows: ${result.emptyRows}`);
    console.log(`Resolved count: ${result.resolvedCount}`);
    console.log(`Pending count: ${result.pendingCount}`);
    
    if (result.errors.length > 0) {
      console.log('\nValidation Errors:');
      result.errors.forEach(error => {
        console.log(`Row ${error.row}: ${error.message}`);
      });
      process.exit(1);
    } else {
      console.log('\nNo validation errors found.');
      process.exit(0);
    }
    
  } catch (error) {
    console.error(`Error reading CSV file: ${error}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}