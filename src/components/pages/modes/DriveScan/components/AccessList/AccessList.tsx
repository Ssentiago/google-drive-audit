import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useGlobalContext } from '../../../../../../core/GlobalContext.tsx';
import {
    Badge,
    Box,
    Button,
    Card,
    Container,
    Drawer,
    Typography,
} from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';

import {
    UndeletedOriginal,
    useScan,
} from '../../../../../../core/ScanContext.tsx';
import 'react-virtualized/styles.css';
import DashboardHero from './components/DashboardHero.tsx';
import { SearchView } from './components/SearchView.tsx';
import { UniqueKey } from './types/types.ts';
import { getUniqueKey } from './utils.ts';
import { HeatmapView } from './components/HeatmapView.tsx';
import { CopiesView } from './components/CopiesView.tsx';

const BulkActionsBar: React.FC<{
    selectedCount: number;
    onProcess: () => void;
    onClear: () => void;
    isProcessing: boolean;
}> = ({ selectedCount, onProcess, onClear, isProcessing }) => {
    if (selectedCount === 0) return null;

    return (
        <Box
            sx={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                bgcolor: 'background.paper',
                borderTop: '2px solid',
                borderColor: 'primary.main',
                p: 2,
                boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
                zIndex: 1200,
            }}
        >
            <Container maxWidth='lg'>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <Typography
                        variant='body1'
                        sx={{ fontWeight: 600 }}
                    >
                        Выделено: {selectedCount}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                            variant='outlined'
                            onClick={onClear}
                            disabled={isProcessing}
                        >
                            Снять
                        </Button>
                        <Button
                            variant='contained'
                            color='error'
                            onClick={onProcess}
                            disabled={isProcessing}
                            size='large'
                        >
                            {isProcessing
                                ? 'Обработка...'
                                : `Обработать (${selectedCount})`}
                        </Button>
                    </Box>
                </Box>
            </Container>
        </Box>
    );
};

// ============ MAIN COMPONENT ============
const AccessList = () => {
    const { setCurrentPage } = useGlobalContext();
    const { result, refresh, setResult } = useScan();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);
    const logBoxRef = useRef<HTMLPreElement>(null);
    const [selectedItems, setSelectedItems] = useState<Set<UniqueKey>>(
        new Set()
    );
    const [logs, setLogs] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewMode, setViewMode] = useState<'heatmap' | 'search' | 'copies'>(
        'search'
    );

    // Search filters
    const [searchUser, setSearchUser] = useState('');
    const [searchFileName, setSearchFileName] = useState('');
    const [searchPath, setSearchPath] = useState('');
    const [filterAccessLevel, setFilterAccessLevel] = useState<
        'all' | 'owner' | 'editor' | 'viewer' | 'commenter'
    >('all');
    const [sortBy, setSortBy] = useState<'name' | 'user' | 'path' | 'level'>(
        'level'
    );

    useEffect(() => {
        if (logBoxRef.current) {
            logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
        }
    }, [logs]);

    const handleProcessCopy = async (copyId: string, originalId: string) => {
        try {
            await invoke('delete_original_from_parent', {
                originalId,
                copyId,
            });

            // Убираем обработанную копию из списка
            setResult((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    undeletedOriginals: prev.undeletedOriginals.filter(
                        (c) => c.copyId !== copyId
                    ),
                };
            });
        } catch (err) {
            console.error('Ошибка при удалении оригинала:', err);
        }
    };

    const handleSelectItems = useCallback((keys: UniqueKey[]) => {
        setSelectedItems((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => next.add(k));
            return next;
        });
    }, []);

    const handleProcess = async () => {
        if (selectedItems.size === 0 || !result) return;
        setIsProcessing(true);
        setLogs([]);

        try {
            const items = result.suspiciousAccesses.filter((r) =>
                selectedItems.has(getUniqueKey(r))
            );
            const BATCH_SIZE = 50;
            const processedOwners: UndeletedOriginal[] = []; // Новое

            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = items.slice(i, i + BATCH_SIZE);
                const batchNum = Math.floor(i / BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(items.length / BATCH_SIZE);

                setLogs((prev) => [
                    ...prev,
                    `\n🔄 Очередь ${batchNum}/${totalBatches} (${batch.length} элементов)...`,
                ]);

                const results = await Promise.allSettled(
                    batch.map(async (item) => {
                        try {
                            if (item.roleType === 'owner') {
                                const copyInfo = await invoke<{
                                    copyId: string;
                                    copyName: string;
                                    copyUrl: string | null;
                                    originalId: string;
                                    originalName: string;
                                    originalUrl: string | null;
                                }>('copy_and_clean', {
                                    itemId: item.itemId,
                                    name: item.name,
                                    parentId: item.parentId,
                                    suspiciousEmails: [
                                        ...new Set(
                                            result.suspiciousAccesses.map(
                                                (r) => r.email
                                            )
                                        ),
                                    ],
                                });

                                // Добавляем в массив обработанных владельцев
                                processedOwners.push({
                                    ...copyInfo,
                                    path: item.path,
                                });

                                return `✅ Копия: ${item.name}`;
                            } else if (item.permissionId) {
                                await invoke('remove_permission', {
                                    fileId: item.itemId,
                                    permissionId: item.permissionId,
                                });
                                return `✅ Удалён: ${item.user} из ${item.name}`;
                            }
                        } catch (error) {
                            return `❌ ${item.name}: ${String(error)}`;
                        }
                    })
                );

                setLogs((prev) => [
                    ...prev,
                    ...results.map((r) =>
                        r.status === 'fulfilled'
                            ? r.value!
                            : '❌ Unexpected error'
                    ),
                ]);
            }

            // Обновляем результаты: убираем обработанные + добавляем новые копии
            setResult((prev) => {
                if (!prev) return prev;

                const processedKeys = new Set(selectedItems);

                return {
                    ...prev,
                    suspiciousAccesses: prev.suspiciousAccesses.filter(
                        (a) => !processedKeys.has(getUniqueKey(a))
                    ),
                    undeletedOriginals: [
                        ...prev.undeletedOriginals,
                        ...processedOwners,
                    ],
                };
            });

            setSelectedItems(new Set());
        } catch (err: any) {
            setLogs((prev) => [...prev, `❌ Критическая ошибка: ${err}`]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleOpenDrawer = () => {
        setDrawerOpen(true);
        setNewLogsCount(0);
    };

    if (!result) {
        return (
            <Container maxWidth='md'>
                <Card sx={{ p: 4, mt: 4 }}>
                    <Typography
                        variant='h4'
                        component='h1'
                        sx={{ mb: 3, textAlign: 'center', fontWeight: 700 }}
                    >
                        Результаты
                    </Typography>
                    <Typography sx={{ mb: 3 }}>
                        Нет данных. Сначала выполните сканирование.
                    </Typography>
                    <Button
                        variant='contained'
                        onClick={() => setCurrentPage('drive-scan')}
                    >
                        ← Назад
                    </Button>
                </Card>
            </Container>
        );
    }

    return (
        <Container
            maxWidth='lg'
            sx={{ pb: 10 }}
        >
            <Card sx={{ p: 4, mt: 4 }}>
                <DashboardHero access={result.suspiciousAccesses} />

                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: 2,
                        mb: 4,
                    }}
                >
                    <Button
                        variant={
                            viewMode === 'search' ? 'contained' : 'outlined'
                        }
                        onClick={() => setViewMode('search')}
                        size='large'
                    >
                        🔍 Поиск
                    </Button>
                    <Button
                        variant={
                            viewMode === 'heatmap' ? 'contained' : 'outlined'
                        }
                        onClick={() => setViewMode('heatmap')}
                        size='large'
                    >
                        🔥 Тепловая карта
                    </Button>
                    <Button
                        variant={
                            viewMode === 'copies' ? 'contained' : 'outlined'
                        }
                        onClick={() => setViewMode('copies')}
                        size='large'
                        sx={{
                            position: 'relative',
                            ...(result.undeletedOriginals.length > 0 && {
                                '&::after': {
                                    content: `"${result.undeletedOriginals.length}"`,
                                    position: 'absolute',
                                    top: -8,
                                    right: -8,
                                    bgcolor: 'error.main',
                                    color: 'white',
                                    borderRadius: '50%',
                                    width: 24,
                                    height: 24,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 12,
                                    fontWeight: 700,
                                },
                            }),
                        }}
                    >
                        📋 Наши копии
                    </Button>
                </Box>

                {viewMode === 'heatmap' && (
                    <HeatmapView
                        access={result.suspiciousAccesses}
                        onSelectFolder={(items) => {
                            setSelectedItems((prev) => {
                                const next = new Set(prev);
                                items.forEach((item) => {
                                    if (
                                        item.roleType === 'owner' ||
                                        item.permissionId
                                    ) {
                                        next.add(getUniqueKey(item));
                                    }
                                });
                                return next;
                            });
                        }}
                    />
                )}

                {viewMode === 'search' && (
                    <SearchView
                        access={result.suspiciousAccesses}
                        selectedItems={selectedItems}
                        onToggleItem={(item) => {
                            setSelectedItems((prev) => {
                                const key = getUniqueKey(item);
                                const next = new Set(prev);
                                if (prev.has(key)) {
                                    next.delete(key);
                                } else {
                                    next.add(key);
                                }
                                return next;
                            });
                        }}
                        onSelectAll={() => {
                            const allKeys = result.suspiciousAccesses
                                .filter(
                                    (r) =>
                                        r.roleType === 'owner' || r.permissionId
                                )
                                .map((r) => getUniqueKey(r) as UniqueKey);
                            setSelectedItems(new Set(allKeys));
                        }}
                        onSelectFiltered={(items) => {
                            setSelectedItems((prev) => {
                                const next = new Set(prev);
                                items.forEach((item) => {
                                    if (
                                        item.roleType === 'owner' ||
                                        item.permissionId
                                    ) {
                                        next.add(getUniqueKey(item));
                                    }
                                });
                                return next;
                            });
                        }}
                        onClearSelection={() => setSelectedItems(new Set())}
                        searchUser={searchUser}
                        onSearchUserChange={setSearchUser}
                        searchFileName={searchFileName}
                        onSearchFileNameChange={setSearchFileName}
                        searchPath={searchPath}
                        onSearchPathChange={setSearchPath}
                        filterAccessLevel={filterAccessLevel}
                        onFilterAccessLevelChange={setFilterAccessLevel}
                        sortBy={sortBy}
                        onSortByChange={setSortBy}
                    />
                )}

                {viewMode === 'copies' && (
                    <CopiesView
                        copies={result.undeletedOriginals}
                        onProcess={handleProcessCopy}
                    />
                )}

                {
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            mt: 3,
                        }}
                    >
                        <Button
                            variant='outlined'
                            startIcon={
                                <Badge
                                    badgeContent={newLogsCount}
                                    color='error'
                                >
                                    <TerminalIcon />
                                </Badge>
                            }
                            onClick={handleOpenDrawer}
                        >
                            Открыть логи ({logs.length})
                        </Button>
                    </Box>
                }
                <Box
                    sx={{
                        display: 'flex',
                        gap: 2,
                        mt: 4,
                        justifyContent: 'center',
                    }}
                >
                    <Button
                        variant='outlined'
                        onClick={() => setCurrentPage('drive-scan')}
                        size='large'
                    >
                        ← Назад
                    </Button>
                </Box>
            </Card>

            <BulkActionsBar
                selectedCount={selectedItems.size}
                onProcess={handleProcess}
                onClear={() => setSelectedItems(new Set())}
                isProcessing={isProcessing}
            />
            <Drawer
                anchor='right'
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            >
                <Box sx={{ width: 600, p: 2 }}>
                    <Typography
                        variant='h6'
                        sx={{ mb: 2 }}
                    >
                        Лог обработки
                    </Typography>
                    <Box
                        component='pre'
                        ref={logBoxRef}
                        sx={{
                            bgcolor: '#1e1e1e',
                            color: '#d4d4d4',
                            p: 2,
                            borderRadius: 1,
                            height: 'calc(100vh - 120px)',
                            overflow: 'auto',
                            fontFamily: 'monospace',
                            fontSize: 13,
                            lineHeight: 1.5,
                            m: 0,
                        }}
                    >
                        {logs.join('\n')}
                    </Box>
                </Box>
            </Drawer>
        </Container>
    );
};

export default AccessList;
