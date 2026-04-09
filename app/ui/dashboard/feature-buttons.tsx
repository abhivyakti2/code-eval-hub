'use client';

import { useState } from 'react';
import { Button } from '@/app/ui/button';
import { generateRepoSummary, generateContributorQuestions, triggerRepoIngestion } from '@/app/lib/actions';

export default function FeatureButtons({
  repoId,
  userId,
}: {
  repoId: string;
  userId: string;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleSummary() {
    setLoading('summary');
    try {
      const summary = await generateRepoSummary(repoId);
      setResult(summary);
    } finally {
      setLoading(null);
    }
  }

  async function handleIngestion() {
    setLoading('ingest');
    try {
      await triggerRepoIngestion(repoId);
      setResult('Repository ingested successfully!');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Repository Actions</h2>
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
        <div className="mt-4 rounded-md bg-gray-50 p-4">
          <p className="whitespace-pre-wrap text-sm">{result}</p>
        </div>
      )}
    </div>
  );
}