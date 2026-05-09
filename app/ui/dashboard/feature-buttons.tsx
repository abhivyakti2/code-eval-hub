'use client';

import { useState } from 'react';
import { Button } from '@/app/ui/button';
import { generateRepoSummaryAction, triggerRepoIngestionAction } from '../../lib/actions';

export default function FeatureButtons({
  repoId,
}: {
  repoId: string;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleSummary() {
    setLoading('summary');
    try {
      const summary = await generateRepoSummaryAction(repoId);
      setResult(summary);
    } catch (error) {
      setResult(
        error instanceof Error
          ? error.message
          : 'Failed to generate summary. Please try again.',
      );
    } finally {
      setLoading(null);
    }
  }

  async function handleIngestion() {
    setLoading('ingest');
    try {
      await triggerRepoIngestionAction(repoId);
      setResult('Repository ingested successfully!');
    } catch (error) {
      setResult(
        error instanceof Error
          ? error.message
          : 'Failed to ingest repository. Please try again.',
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-6 shadow-sm shadow-slate-950/30">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Repository Actions</h2>
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={handleSummary}
          disabled={loading === 'summary'}
        >
          {loading === 'summary' ? 'Generating...' : 'Generate Summary'}
        </Button>
        <Button
          onClick={handleIngestion}
          disabled={loading === 'ingest'}
        >
          {loading === 'ingest' ? 'Ingesting...' : 'Ingest Repository'}
        </Button>
      </div>
      {result && (
        <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/50 p-4">
          <p className="whitespace-pre-wrap text-sm text-slate-200">{result}</p>
        </div>
      )}
    </div>
  );
}
