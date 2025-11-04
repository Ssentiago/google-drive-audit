import React, {
    useState,
    useMemo,
    useRef,
    useEffect,
    useCallback,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useGlobalContext } from '../../../../../core/GlobalContext.tsx';
import {
    Container,
    Card,
    Typography,
    Button,
    Box,
    Checkbox,
    Link,
    ToggleButtonGroup,
    ToggleButton,
    Breadcrumbs,
    Tooltip,
} from '@mui/material';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useScan } from '../../../../../core/ScanContext.tsx';
import { List, AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css';
import RefreshIcon from '@mui/icons-material/Refresh';

type SortMode = 'default' | 'path';
type ViewMode = 'folders' | 'table';
type UniqueKey = string; // "fileId:permissionId" или "fileId:owner"

interface FolderGroup {
    path: string;
    count: number;
    items: any[];
}

// ✅ ОСНОВНОЙ КОМПОНЕНТ
const AccessList = () => {
    const { setCurrentPage } = useGlobalContext();
    const { result, refresh } = useScan();

    // ✅ УНИКАЛЬНЫЕ КЛЮЧИ
    const [selectedItems, setSelectedItems] = useState<Set<UniqueKey>>(
        new Set()
    );
    const [logs, setLogs] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('folders');
    const [sortMode, setSortMode] = useState<SortMode>('default');
    const [verifyLogs, setVerifyLogs] = useState<string[]>([]);
    const [isVerifying, setIsVerifying] = useState(false);
    const [verifyProgress, setVerifyProgress] = useState(0);
    const [totalToVerify, setTotalToVerify] = useState(0);

    // ✅ УНИКАЛЬНЫЕ ФУНКЦИИ
    const getUniqueKey = useCallback((item: any): UniqueKey => {
        if (item.type === 'owner') return `${item.itemId}:owner`;
        return `${item.itemId}:${item.permissionId}`;
    }, []);

    const isSelected = useCallback(
        (item: any): boolean => {
            return selectedItems.has(getUniqueKey(item));
        },
        [selectedItems, getUniqueKey]
    );

    const toggleSelection = useCallback(
        (item: any) => {
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
        },
        [getUniqueKey]
    );

    const selectedCount = selectedItems.size;

    // ✅ ГРУППОВОЕ ВЫДЕЛЕНИЕ
    const selectInFolder = useCallback(
        (folderPath: string, result: any) => {
            const itemsInFolder = result.access.filter(
                (item: any) =>
                    item.path === folderPath &&
                    (item.type === 'owner' || item.permissionId)
            );

            setSelectedItems((prev) => {
                const next = new Set(prev);
                const wasFullySelected = itemsInFolder.every((item: any) =>
                    prev.has(getUniqueKey(item))
                );

                itemsInFolder.forEach((item: any) => {
                    const key = getUniqueKey(item);
                    if (wasFullySelected) {
                        next.delete(key);
                    } else {
                        next.add(key);
                    }
                });
                return next;
            });
        },
        [getUniqueKey]
    );

    const selectOnlyOwnersInFolder = useCallback(
        (folderPath: string, result: any) => {
            const ownerKeys = result.access
                .filter((r: any) => r.type === 'owner' && r.path === folderPath)
                .map((r: any) => getUniqueKey(r) as UniqueKey);
            setSelectedItems(new Set(ownerKeys));
        },
        [getUniqueKey]
    );

    const selectOnlyPermissionsInFolder = useCallback(
        (folderPath: string, result: any) => {
            const permKeys = result.access
                .filter((r: any) => r.permissionId && r.path === folderPath)
                .map((r: any) => getUniqueKey(r) as UniqueKey);
            setSelectedItems(new Set(permKeys));
        },
        [getUniqueKey]
    );

    const selectedInGroup = useCallback(
        (folderPath: string, result: any) => {
            return result.access.filter(
                (item: any) => item.path === folderPath && isSelected(item)
            ).length;
        },
        [isSelected]
    );

    const handleProcess = async () => {
        if (selectedCount === 0) return;
        setIsProcessing(true);
        setLogs([]);

        try {
            const items = result!.access.filter((r: any) => isSelected(r));
            const BATCH_SIZE = 50;

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
                            if (item.type === 'owner') {
                                await invoke('copy_and_clean', {
                                    itemId: item.itemId,
                                    name: item.name,
                                    parentId: item.parentId,
                                    suspiciousEmails: [
                                        ...new Set(
                                            result!.access.map(
                                                (r: any) => r.email
                                            )
                                        ),
                                    ],
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

            await refresh();
            setSelectedItems(new Set());
        } catch (err: any) {
            setLogs((prev) => [...prev, `❌ Критическая ошибка: ${err}`]);
        } finally {
            setIsProcessing(false);
        }
    };
    const handleVerifyAccess = async () => {
        if (!result) return;

        const itemsToCheck = result.access.filter(
            (r: any) => r.type === 'owner' || r.permissionId
        );

        setTotalToVerify(itemsToCheck.length);
        setVerifyProgress(0);
        setIsVerifying(true);
        setVerifyLogs([]);

        try {
            for (let i = 0; i < itemsToCheck.length; i++) {
                const item = itemsToCheck[i];
                try {
                    setVerifyProgress(i + 1);

                    const isValid = await invoke<boolean>('verify_access', {
                        itemId: item.itemId,
                        email: item.email,
                        permissionId: item.permissionId || null,
                    });

                    if (!isValid) {
                        setVerifyLogs((prev) => [
                            ...prev,
                            `❌ Удалён из кеша: ${item.user} → ${item.name}`,
                        ]);
                    }
                } catch (error) {
                    setVerifyLogs((prev) => [
                        ...prev,
                        `⚠️ Пропуск ${item.name}: ${String(error)}`,
                    ]);
                }
            }

            await refresh();
            setVerifyLogs((prev) => [...prev, '✅ Верификация завершена']);
        } catch (err) {
            setVerifyLogs((prev) => [...prev, `Ошибка: ${String(err)}`]);
        } finally {
            setIsVerifying(false);
            setVerifyProgress(0);
            setTotalToVerify(0);
        }
    };

    const formatDate = (iso: string) => {
        try {
            return format(new Date(iso), 'd MMMM yyyy, HH:mm', { locale: ru });
        } catch {
            return 'неизвестно';
        }
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

    const FoldersView = () => {
        const pathGroups = useMemo(() => {
            if (!result) return [];
            const groups: Record<string, FolderGroup> = {};
            for (const item of result.access) {
                const folderPath = item.path;
                if (!groups[folderPath]) {
                    groups[folderPath] = {
                        path: folderPath,
                        count: 0,
                        items: [],
                    };
                }
                groups[folderPath]!.count++;
                groups[folderPath]!.items.push(item);
            }
            return Object.entries(groups)
                .map(([_, data]) => data)
                .sort((a, b) => a.path.localeCompare(b.path));
        }, [result]);

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Глобальные кнопки */}
                <Box
                    sx={{
                        display: 'flex',
                        gap: 2,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    <Button
                        variant='contained'
                        onClick={() => {
                            const allSelectable = result.access
                                .filter(
                                    (r: any) =>
                                        r.type === 'owner' || r.permissionId
                                )
                                .map((r: any) => getUniqueKey(r) as UniqueKey);
                            setSelectedItems(new Set(allSelectable));
                        }}
                        size='large'
                        startIcon={<Checkbox checked />}
                    >
                        Выделить всё ({result.access.length})
                    </Button>
                    <Button
                        variant='outlined'
                        onClick={() => {
                            const ownerKeys = result.access
                                .filter((r: any) => r.type === 'owner')
                                .map((r: any) => getUniqueKey(r) as UniqueKey);
                            setSelectedItems(new Set(ownerKeys));
                        }}
                        size='large'
                    >
                        Только владельцы (
                        {
                            result.access.filter((r: any) => r.type === 'owner')
                                .length
                        }
                        )
                    </Button>
                    <Button
                        variant='outlined'
                        onClick={() => {
                            const permKeys = result.access
                                .filter((r: any) => r.permissionId)
                                .map((r: any) => getUniqueKey(r) as UniqueKey);
                            setSelectedItems(new Set(permKeys));
                        }}
                        size='large'
                    >
                        Только доступы (
                        {
                            result.access.filter((r: any) => r.permissionId)
                                .length
                        }
                        )
                    </Button>
                    {selectedCount > 0 && (
                        <Button
                            variant='outlined'
                            color='error'
                            onClick={() => setSelectedItems(new Set())}
                            size='large'
                        >
                            Снять ({selectedCount})
                        </Button>
                    )}
                </Box>

                {/* Список папок */}
                <Box
                    sx={{
                        maxHeight: 400,
                        overflow: 'auto',
                        p: 1.5,
                        bgcolor: 'grey.50',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                    }}
                >
                    <Typography
                        variant='body2'
                        sx={{ mb: 1.5, fontWeight: 600, fontSize: 13 }}
                    >
                        {selectedCount} / {result.access.length} выделено
                    </Typography>
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.5,
                        }}
                    >
                        {pathGroups.map((group) => {
                            const countInGroup = selectedInGroup(
                                group.path,
                                result
                            );
                            const canSelect = group.items.some(
                                (item: any) =>
                                    item.type === 'owner' || item.permissionId
                            );
                            const ownerCount = group.items.filter(
                                (item: any) => item.type === 'owner'
                            ).length;
                            const permCount = group.items.filter(
                                (item: any) => item.permissionId
                            ).length;

                            return (
                                <Box
                                    key={group.path}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        py: 1,
                                        px: 2,
                                        borderRadius: 1,
                                        cursor: canSelect
                                            ? 'pointer'
                                            : 'default',
                                        '&:hover': canSelect
                                            ? { bgcolor: 'action.hover' }
                                            : {},
                                        bgcolor:
                                            countInGroup > 0
                                                ? 'primary.25'
                                                : 'transparent',
                                    }}
                                    onClick={() =>
                                        canSelect &&
                                        selectInFolder(group.path, result)
                                    }
                                >
                                    <Checkbox
                                        size='small'
                                        checked={
                                            countInGroup === group.count &&
                                            group.count > 0
                                        }
                                        indeterminate={
                                            countInGroup > 0 &&
                                            countInGroup < group.count
                                        }
                                        disabled={!canSelect}
                                        sx={{ p: 0.5, flexShrink: 0 }}
                                    />

                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography
                                            variant='body2'
                                            sx={{
                                                fontWeight: 600,
                                                fontSize: 14,
                                            }}
                                        >
                                            {group.path || 'Корень'}
                                        </Typography>
                                    </Box>

                                    <Tooltip title='Выделить все элементы в папке'>
                                        <Button
                                            size='small'
                                            variant='contained'
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                selectInFolder(
                                                    group.path,
                                                    result
                                                );
                                            }}
                                            disabled={!canSelect}
                                            sx={{
                                                minWidth: 52,
                                                height: 28,
                                                px: 0.5,
                                                fontSize: 11,
                                                fontWeight: 600,
                                            }}
                                        >
                                            Все
                                        </Button>
                                    </Tooltip>

                                    {ownerCount > 0 && (
                                        <Tooltip
                                            title={`Выделить только владельцев (${ownerCount})`}
                                        >
                                            <Button
                                                size='small'
                                                variant='outlined'
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    selectOnlyOwnersInFolder(
                                                        group.path,
                                                        result
                                                    );
                                                }}
                                                sx={{
                                                    minWidth: 52,
                                                    height: 28,
                                                    px: 0.5,
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                👑
                                            </Button>
                                        </Tooltip>
                                    )}

                                    {permCount > 0 && (
                                        <Tooltip
                                            title={`Выделить только доступы (${permCount})`}
                                        >
                                            <Button
                                                size='small'
                                                variant='outlined'
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    selectOnlyPermissionsInFolder(
                                                        group.path,
                                                        result
                                                    );
                                                }}
                                                sx={{
                                                    minWidth: 52,
                                                    height: 28,
                                                    px: 0.5,
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                🔓
                                            </Button>
                                        </Tooltip>
                                    )}

                                    <Box
                                        sx={{
                                            minWidth: 45,
                                            textAlign: 'right',
                                            fontWeight: 700,
                                            fontSize: 14,
                                        }}
                                    >
                                        <Typography
                                            variant='body2'
                                            color={
                                                countInGroup > 0
                                                    ? 'primary.main'
                                                    : 'text.secondary'
                                            }
                                        >
                                            {countInGroup}/{group.count}
                                        </Typography>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            </Box>
        );
    };

    const TableView = () => {
        const sortedList = useMemo(() => {
            if (!result) return [];
            if (sortMode === 'default') return result.access;
            return [...result.access].sort((a: any, b: any) =>
                a.path.localeCompare(b.path)
            );
        }, [result, sortMode]);

        const listRef = useRef<any>(null);

        const renderPath = (
            path: string,
            parentId: string,
            itemId: string,
            itemType: string
        ) => {
            const parts = path.split(' / ');
            return (
                <Breadcrumbs
                    separator='›'
                    sx={{ fontSize: 12 }}
                >
                    {parts.map((part, i) => {
                        const isLast = i === parts.length - 1;
                        if (isLast) {
                            const folderId =
                                itemType === 'Папка' ? itemId : parentId;
                            const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
                            return (
                                <Link
                                    key={i}
                                    component='button'
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        console.log(
                                            path,
                                            parentId,
                                            itemId,
                                            folderUrl
                                        );
                                        invoke('open_url', { url: folderUrl });
                                    }}
                                    sx={{
                                        fontSize: 12,
                                        cursor: 'pointer',
                                        color: 'primary.main',
                                        textDecoration: 'underline',
                                    }}
                                >
                                    {part}
                                </Link>
                            );
                        }
                        return (
                            <Typography
                                key={i}
                                sx={{ fontSize: 12, color: 'text.secondary' }}
                            >
                                {part}
                            </Typography>
                        );
                    })}
                </Breadcrumbs>
            );
        };

        const rowRenderer = ({ index, key, style }: any) => {
            if (!sortedList[index]) return null;
            const r = sortedList[index];
            const canSelect = r.type === 'owner' || !!r.permissionId;
            const isSelectedItem = isSelected(r);

            return (
                <div
                    key={key}
                    style={style}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            minHeight: 60,
                            maxHeight: 120,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            opacity: canSelect ? 1 : 0.5,
                            bgcolor: isSelectedItem
                                ? 'primary.50'
                                : 'transparent',
                            '&:hover': {
                                bgcolor: isSelectedItem
                                    ? 'primary.100'
                                    : 'action.hover',
                            },
                            px: 2,
                            py: 2,
                            boxSizing: 'border-box',
                            overflow: 'hidden',
                        }}
                    >
                        <Box sx={{ width: 48, flexShrink: 0, pt: 1 }}>
                            {canSelect && (
                                <Checkbox
                                    checked={isSelectedItem}
                                    onChange={() => toggleSelection(r)}
                                />
                            )}
                        </Box>
                        <Box
                            sx={{
                                width: 60,
                                flexShrink: 0,
                                pt: 1.5,
                                fontSize: 18,
                            }}
                        >
                            {r.itemType === 'Папка' ? '📁' : '📄'}
                        </Box>
                        <Box sx={{ width: 200, flexShrink: 0, pr: 2 }}>
                            <Typography
                                sx={{
                                    fontWeight: 600,
                                    fontSize: 14,
                                    wordBreak: 'break-word',
                                    lineHeight: 1.4,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                }}
                            >
                                {r.name}
                            </Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pr: 2 }}>
                            {renderPath(
                                r.path,
                                r.parentId,
                                r.itemId,
                                r.itemType
                            )}
                        </Box>
                        <Box sx={{ width: 180, flexShrink: 0, pr: 2 }}>
                            <Typography sx={{ fontSize: 14 }}>
                                {r.user}
                            </Typography>
                        </Box>
                        <Box sx={{ width: 120, flexShrink: 0, pr: 2 }}>
                            <Typography sx={{ fontSize: 14 }}>
                                {r.type === 'owner' ? '👑 Владелец' : r.role}
                            </Typography>
                        </Box>
                        <Box sx={{ width: 80, flexShrink: 0 }}>
                            <Link
                                component='button'
                                onClick={(e) => {
                                    e.stopPropagation();
                                    invoke('open_url', { url: r.url });
                                }}
                                sx={{ fontSize: 12, cursor: 'pointer' }}
                            >
                                Открыть
                            </Link>
                        </Box>
                    </Box>
                </div>
            );
        };

        useEffect(() => {
            if (listRef.current) {
                listRef.current.recomputeRowHeights();
            }
        }, [sortedList]);

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ToggleButtonGroup
                    value={sortMode}
                    exclusive
                    onChange={(_, val) => val && setSortMode(val)}
                    size='small'
                >
                    <ToggleButton value='default'>По умолчанию</ToggleButton>
                    <ToggleButton value='path'>По пути</ToggleButton>
                </ToggleButtonGroup>

                <Box
                    sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        height: 500,
                    }}
                >
                    <AutoSizer>
                        {({ height, width }) => (
                            <List
                                ref={listRef}
                                height={height}
                                width={width}
                                rowCount={sortedList.length}
                                rowHeight={80}
                                rowRenderer={rowRenderer}
                            />
                        )}
                    </AutoSizer>
                </Box>
            </Box>
        );
    };

    return (
        <Container maxWidth='lg'>
            <Card sx={{ p: 4, mt: 4 }}>
                <Typography
                    variant='h4'
                    component='h1'
                    sx={{ mb: 3, textAlign: 'center', fontWeight: 700 }}
                >
                    Результаты сканирования
                </Typography>

                <Typography
                    variant='body2'
                    sx={{ color: 'text.secondary', mb: 2, textAlign: 'center' }}
                >
                    {formatDate(result.scanDate)} · Найдено:{' '}
                    <strong>{result.access.length}</strong>
                </Typography>

                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                    <Button
                        variant='outlined'
                        startIcon={<RefreshIcon />}
                        onClick={handleVerifyAccess}
                        disabled={isVerifying}
                        size='large'
                    >
                        {isVerifying
                            ? `🔍 Проверяем... (${verifyProgress}/${totalToVerify})`
                            : '🔍 Перепроверить доступы'}
                    </Button>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4 }}>
                    <Button
                        variant={
                            viewMode === 'folders' ? 'contained' : 'outlined'
                        }
                        onClick={() => setViewMode('folders')}
                        sx={{ mr: 2, px: 4 }}
                        size='large'
                    >
                        📁 По папкам
                    </Button>
                    <Button
                        variant={
                            viewMode === 'table' ? 'contained' : 'outlined'
                        }
                        onClick={() => setViewMode('table')}
                        sx={{ px: 4 }}
                        size='large'
                    >
                        📋 Таблица
                    </Button>
                </Box>

                {selectedCount > 0 && (
                    <Box
                        sx={{
                            display: 'flex',
                            gap: 2,
                            mb: 3,
                            justifyContent: 'center',
                        }}
                    >
                        <Button
                            variant='contained'
                            color='error'
                            onClick={handleProcess}
                            disabled={isProcessing}
                            size='large'
                            startIcon={isProcessing ? <div /> : null}
                        >
                            {isProcessing
                                ? 'Обработка...'
                                : `Обработать (${selectedCount})`}
                        </Button>
                        <Button
                            variant='outlined'
                            onClick={() => setSelectedItems(new Set())}
                            size='large'
                        >
                            Снять выделение
                        </Button>
                    </Box>
                )}

                <Box sx={{ height: viewMode === 'folders' ? 600 : 650 }}>
                    {viewMode === 'folders' ? <FoldersView /> : <TableView />}
                </Box>

                {logs.length > 0 && (
                    <Box
                        component='pre'
                        sx={{
                            bgcolor: '#1e1e1e',
                            color: '#d4d4d4',
                            p: 2,
                            borderRadius: 1,
                            maxHeight: 120,
                            overflow: 'auto',
                            fontFamily: 'monospace',
                            fontSize: 13,
                            lineHeight: 1.5,
                            mt: 3,
                        }}
                    >
                        {logs.join('\n')}
                    </Box>
                )}

                {verifyLogs.length > 0 && (
                    <Box
                        component='pre'
                        sx={{
                            bgcolor: '#f5f5f5',
                            color: '#333',
                            p: 2,
                            borderRadius: 1,
                            maxHeight: 120,
                            overflow: 'auto',
                            fontFamily: 'monospace',
                            fontSize: 13,
                            lineHeight: 1.5,
                            mt: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        {verifyLogs.join('\n')}
                    </Box>
                )}

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
        </Container>
    );
};

export default AccessList;
