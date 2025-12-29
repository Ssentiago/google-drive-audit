import React, {
    createContext,
    useContext,
    useState,
    ReactNode,
    useEffect,
    SetStateAction,
} from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface Access {
    roleType: string;
    itemType: string;
    name: string;
    url: string;
    user: string;
    role: string;
    itemId: string;
    email: string;
    parentId: string;
    permissionId: string | null;
    path: string;
}

export interface UndeletedOriginal {
    copyId: string;
    copyName: string;
    copyUrl: string | null;
    originalId: string;
    originalName: string;
    originalUrl: string | null;
    path: string;
}

interface ScanResult {
    suspiciousAccesses: Access[];
    undeletedOriginals: UndeletedOriginal[];
    processedFiles: number;
    processedFolders: number;
}

interface ScanContextType {
    result: ScanResult | null;
    setResult: React.Dispatch<SetStateAction<ScanResult | null>>;
    refresh: () => Promise<void>;
}

const ScanContext = createContext<ScanContextType | undefined>(undefined);

export const ScanProvider = ({ children }: { children: ReactNode }) => {
    const [result, setResult] = useState<ScanResult | null>(null);

    const loadFromCache = async () => {
        try {
            const cached: ScanResult = await invoke('load_scan_cache');
            console.log(cached);

            setResult(cached);
        } catch {
            setResult(null);
        }
    };

    const refresh = async () => {
        await loadFromCache();
    };

    useEffect(() => {
        loadFromCache();
    }, []);

    return (
        <ScanContext.Provider value={{ result, refresh, setResult }}>
            {children}
        </ScanContext.Provider>
    );
};

export const useScan = () => {
    const context = useContext(ScanContext);
    if (!context) throw new Error('useScan must be used within ScanProvider');
    return context;
};
