// src/core/ScanContext.tsx
import {
    createContext,
    useContext,
    useState,
    ReactNode,
    useEffect,
} from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AccessResult {
    type: string;
    itemType: string;
    name: string;
    url: string;
    user: string;
    role: string;
    itemId: string;
    email: string;
    parentId: string;
    permissionId?: string;
    path: string;
}

interface ScanResult {
    access: AccessResult[];
    scanDate: string;
}

interface ScanInfo {
    scan_date: string;
    email_count: number;
    emails: string[];
    total_access_count: number;
}

interface ScanContextType {
    result: ScanResult | null;
    scanInfo: ScanInfo | null;
    isFromCache: boolean;
    refresh: () => Promise<void>;
}

const ScanContext = createContext<ScanContextType | undefined>(undefined);

export const ScanProvider = ({ children }: { children: ReactNode }) => {
    const [result, setResult] = useState<ScanResult | null>(null);
    const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
    const [isFromCache, setIsFromCache] = useState(false);

    const loadFromCache = async () => {
        try {
            const cached: ScanResult = await invoke('load_scan_cache');
            const info: ScanInfo | null = await invoke('get_scan_info');
            setResult(cached);
            setScanInfo(info);
            setIsFromCache(true);
        } catch {
            setResult(null);
            setScanInfo(null);
            setIsFromCache(false);
        }
    };

    const refresh = async () => {
        await loadFromCache();
    };

    useEffect(() => {
        loadFromCache();
    }, []);

    return (
        <ScanContext.Provider
            value={{ result, scanInfo, isFromCache, refresh }}
        >
            {children}
        </ScanContext.Provider>
    );
};

export const useScan = () => {
    const context = useContext(ScanContext);
    if (!context) throw new Error('useScan must be used within ScanProvider');
    return context;
};
