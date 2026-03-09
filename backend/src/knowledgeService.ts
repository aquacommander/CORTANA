import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

type KnowledgeDoc = {
  id: string;
  title: string;
  content: string;
};

const RESOURCE_DIR = path.resolve(process.cwd(), 'resources');

const DEFAULT_DOCS: KnowledgeDoc[] = [
  {
    id: 'campaign_basics',
    title: 'Campaign Basics',
    content:
      'Every campaign should define objective, audience, tone, platform, and success metric. Keep messaging concise and audience-specific.',
  },
  {
    id: 'social_best_practices',
    title: 'Social Best Practices',
    content:
      'Instagram: visual-first and short caption. YouTube: story arc + hook in first 5 seconds. TikTok: fast cuts and strong CTA.',
  },
  {
    id: 'persona_framing',
    title: 'Persona Framing',
    content:
      'Kids audience: playful, simple language. Professional audience: clear benefits, trustworthy tone. Creator audience: authentic and trend-aware.',
  },
];

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function overlapScore(query: string, content: string): number {
  const q = new Set(tokenize(query));
  const c = tokenize(content);
  if (q.size === 0 || c.length === 0) return 0;
  let hits = 0;
  for (const token of c) {
    if (q.has(token)) hits += 1;
  }
  return hits / Math.max(8, c.length);
}

async function loadDocsFromDisk(): Promise<KnowledgeDoc[]> {
  try {
    const entries = await readdir(RESOURCE_DIR, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt')))
      .map((entry) => entry.name);
    if (files.length === 0) return [];

    const docs: KnowledgeDoc[] = [];
    for (const file of files) {
      const fullPath = path.join(RESOURCE_DIR, file);
      const content = await readFile(fullPath, 'utf8');
      const title = file.replace(/\.(md|txt)$/i, '');
      docs.push({
        id: title.toLowerCase().replace(/\s+/g, '_'),
        title,
        content: content.trim(),
      });
    }
    return docs;
  } catch {
    return [];
  }
}

export async function getKnowledgeContext(query: string, maxDocs = 3): Promise<string> {
  const docsFromDisk = await loadDocsFromDisk();
  const docs = docsFromDisk.length > 0 ? docsFromDisk : DEFAULT_DOCS;
  const ranked = docs
    .map((doc) => ({ doc, score: overlapScore(query, `${doc.title}\n${doc.content}`) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocs)
    .map(({ doc }) => `- ${doc.title}: ${doc.content}`);

  return ranked.join('\n');
}
