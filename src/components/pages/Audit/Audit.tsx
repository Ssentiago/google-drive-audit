import React, { useState } from 'react';
import { AuditResults } from './AuditResults/AuditResults.tsx';
import { AuditScan } from './AuditScan/AuditScan.tsx';
import { AuditResult } from './types/interfaces.ts';

export const Audit: React.FC = () => {
    const [result, setResult] = useState<AuditResult | null>(null);

    if (!result) {
        return <AuditScan onScanComplete={setResult} />;
    }

    return (
        <AuditResults
            result={result}
            onBack={() => setResult(null)}
        />
    );
};
