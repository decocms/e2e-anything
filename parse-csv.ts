export interface Bug {
  section: string;
  error: string;
  requiresLogin: string;
  tester: string;
  notes: string;
  resolved: boolean;
  urls?: string[];
}

export async function parseBugsCSV(filePath: string): Promise<Bug[]> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split('\n');
  
  const bugs: Bug[] = [];
  let currentBug: Bug | null = null;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = parseCSVLine(line);
    if (fields.length < 5) continue;
    
    const [section, error, loggedIn, tester, notes] = fields;
    
    if (section.trim()) {
      if (currentBug) {
        bugs.push(currentBug);
      }
      
      currentBug = {
        section: section.trim(),
        error: error.trim(),
        requiresLogin: loggedIn.trim(),
        tester: tester.trim(),
        notes: notes.trim(),
        resolved: isResolved(notes),
        urls: []
      };
    } else if (currentBug && error.trim() && isURL(error.trim())) {
      if (!currentBug.urls) currentBug.urls = [];
      currentBug.urls.push(error.trim());
    }
  }
  
  if (currentBug) {
    bugs.push(currentBug);
  }
  
  return bugs;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  
  fields.push(current);
  return fields;
}

function isResolved(notes: string): boolean {
  const normalizedNotes = notes.toLowerCase();
  return normalizedNotes.includes('resolvido') || normalizedNotes.includes('ajustado');
}

function isURL(text: string): boolean {
  return text.startsWith('http://') || text.startsWith('https://');
}