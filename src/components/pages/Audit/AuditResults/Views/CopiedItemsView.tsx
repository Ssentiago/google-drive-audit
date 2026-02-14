import React, { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    alpha,
    Box,
    Button,
    Card,
    Checkbox,
    Chip,
    IconButton,
    InputAdornment,
    MenuItem,
    Paper,
    Select,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';

import {
    ContentCopy as CopyIcon,
    Delete as DeleteIcon,
    DeleteSweep as DeleteSweepIcon,
    Search as SearchIcon,
} from '@mui/icons-material';
import LogDrawer from '../../../../common/LogDrawer.tsx';
import { AuditResult, Item } from '../../types/interfaces.ts';
import { AutoSizer, List as VirtualList } from 'react-virtualized';

const CopiedItemsView: React.FC<{
    result: AuditResult;
    onLogsUpdate: (msg: string) => void;
    onResultUpdate: (result: AuditResult) => void;
    logs: string[];
}> = ({ result, onLogsUpdate, onResultUpdate, logs }) => {
    const [searchName, setSearchName] = useState('');
    const [searchPath, setSearchPath] = useState('');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [selectedLinked, setSelectedLinked] = useState<Set<string>>(
        new Set()
    );
    const [selectedOrphaned, setSelectedOrphaned] = useState<Set<string>>(
        new Set()
    );
    const [deleting, setDeleting] = useState(false);
    const [subTab, setSubTab] = useState<'linked' | 'orphaned'>('linked');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);

    const linkedCopies = useMemo(() => {
        console.log('=== LINKED COPIES RECALC ===');
        console.log('Total items in result:', Object.keys(result.items).length);

        const withCopiedFlag = Object.values(result.items).filter(
            (item) => item.properties.is_copied === 'true'
        );
        console.log(
            'Items with is_copied=true:',
            withCopiedFlag.length,
            withCopiedFlag.map((i) => i.name)
        );

        const withBothFlags = withCopiedFlag.filter(
            (item) => item.properties.copy_item_id
        );
        console.log(
            'Items with both flags:',
            withBothFlags.length,
            withBothFlags.map((i) => ({
                name: i.name,
                copyId: i.properties.copy_item_id?.slice(0, 8),
            }))
        );

        return withCopiedFlag.map((item) => ({
            id: item.id,
            name: item.name,
            path: item.path,
            type: item.mimeType.includes('folder') ? 'folder' : 'file',
            copyId: item.properties.copy_item_id!,
        }));
    }, [result]);
    const orphanedCopies = useMemo(() => {
        return Object.values(result.items)
            .filter((item) => {
                const hasOriginalId = item.properties.original_item_id;
                if (
                    hasOriginalId &&
                    !result.items[item.properties.original_item_id]
                ) {
                    return true;
                }

                const isCopied = item.properties.is_copied === 'true';
                const copyId = item.properties.copy_item_id;
                if (isCopied && copyId && !result.items[copyId]) {
                    return true;
                }

                return false;
            })
            .map((item) => ({
                id: item.id,
                name: item.name,
                path: item.path,
                type: item.mimeType.includes('folder') ? 'folder' : 'file',
            }));
    }, [result]);

    const filteredLinked = useMemo(() => {
        return linkedCopies.filter((item) => {
            const matchName =
                searchName === '' ||
                item.name.toLowerCase().includes(searchName.toLowerCase());
            const matchPath =
                searchPath === '' ||
                item.path.toLowerCase().includes(searchPath.toLowerCase());
            const matchType =
                typeFilter === 'all' ||
                (typeFilter === 'folder' && item.type === 'folder') ||
                (typeFilter === 'file' && item.type === 'file');

            return matchName && matchPath && matchType;
        });
    }, [linkedCopies, searchName, searchPath, typeFilter]);

    const filteredOrphaned = useMemo(() => {
        return orphanedCopies.filter((item) => {
            const matchName =
                searchName === '' ||
                item.name.toLowerCase().includes(searchName.toLowerCase());
            const matchPath =
                searchPath === '' ||
                item.path.toLowerCase().includes(searchPath.toLowerCase());
            const matchType =
                typeFilter === 'all' ||
                (typeFilter === 'folder' && item.type === 'folder') ||
                (typeFilter === 'file' && item.type === 'file');

            return matchName && matchPath && matchType;
        });
    }, [orphanedCopies, searchName, searchPath, typeFilter]);

    const updateLocalItem = (itemId: string, updates: Partial<Item>) => {
        const item = result.items[itemId];
        if (!item) return;

        onResultUpdate({
            ...result,
            items: {
                ...result.items,
                [itemId]: {
                    ...item,
                    ...updates,
                },
            },
        });
    };

    const removeLocalItem = (itemId: string) => {
        const newItems = { ...result.items };
        delete newItems[itemId];

        onResultUpdate({
            ...result,
            items: newItems,
        });
    };

    const deleteProperty = async (itemId: string, propertyName: string) => {
        try {
            await invoke('delete_property', { itemId, propertyName });
            onLogsUpdate(`✅ Удалено свойство "${propertyName}"`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);

            const item = result.items[itemId];
            if (item) {
                const updatedProps = { ...item.properties };
                delete updatedProps[propertyName];
                updateLocalItem(itemId, { properties: updatedProps });
            }
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка удаления свойства: ${e}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        }
    };

    const deleteOriginal = async (originalId: string, copyId: string) => {
        try {
            console.log(originalId, copyId);
            await invoke('delete_original_from_parent', { originalId, copyId });
            onLogsUpdate(
                `🗑️ Удалён оригинал: ${result.items[originalId]?.name || originalId}`
            );
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
            removeLocalItem(originalId);
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка удаления: ${e}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        }
    };

    const cleanOrphanedProperties = async (itemId: string) => {
        const item = result.items[itemId];
        if (!item) return;

        if (item.properties.is_copied) {
            await deleteProperty(itemId, 'is_copied');
        }
        if (item.properties.copy_item_id) {
            await deleteProperty(itemId, 'copy_item_id');
        }
        if (item.properties.original_item_id) {
            await deleteProperty(itemId, 'original_item_id');
        }
    };

    const bulkDeleteLinked = async () => {
        if (selectedLinked.size === 0) return;
        setDeleting(true);

        // Сортируем: сначала файлы, потом папки от глубоких к корневым
        const items = filteredLinked
            .filter((i) => selectedLinked.has(i.id))
            .sort((a, b) => {
                // Сначала файлы, потом папки
                if (a.type !== b.type) {
                    return a.type === 'file' ? -1 : 1;
                }

                // Папки: чем глубже путь (больше '/'), тем раньше обработать
                if (a.type === 'folder' && b.type === 'folder') {
                    const depthA = (a.path.match(/\//g) || []).length;
                    const depthB = (b.path.match(/\//g) || []).length;
                    return depthB - depthA; // от глубоких к корневым
                }

                return 0;
            });

        const BATCH_SIZE = 10;
        const toRemove = new Set<string>();

        onLogsUpdate(`📋 Удаление ${items.length} оригиналов...`);
        if (!drawerOpen) setNewLogsCount((c) => c + 1);

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(items.length / BATCH_SIZE);

            onLogsUpdate(
                `🔄 Батч ${batchNum}/${totalBatches} (${batch.length} элементов)...`
            );
            if (!drawerOpen) setNewLogsCount((c) => c + 1);

            const results = await Promise.allSettled(
                batch.map(async (item) => {
                    try {
                        await invoke('delete_original_from_parent', {
                            originalId: item.id,
                            copyId: item.copyId,
                        });
                        toRemove.add(item.id);
                        return `✅ ${result.items[item.id]?.name || item.id}`;
                    } catch (e: any) {
                        toRemove.add(item.id);
                        return `❌ ${result.items[item.id]?.name || item.id}: ${e}`;
                    }
                })
            );

            results.forEach((r) => {
                const msg =
                    r.status === 'fulfilled' ? r.value : `❌ ${r.reason}`;
                onLogsUpdate(msg);
                if (!drawerOpen) setNewLogsCount((c) => c + 1);
            });

            const done = results.filter(
                (r) => r.status === 'fulfilled' && r.value?.startsWith('✅')
            ).length;
            const failed = batch.length - done;
            onLogsUpdate(`📊 Батч ${batchNum}: ✅ ${done} / ❌ ${failed}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        }

        onLogsUpdate(`✨ Готово. Удалено: ${toRemove.size} оригиналов`);
        if (!drawerOpen) setNewLogsCount((c) => c + 1);

        const newItems = { ...result.items };
        toRemove.forEach((id) => delete newItems[id]);

        onResultUpdate({
            ...result,
            items: newItems,
        });

        setDeleting(false);
        setSelectedLinked(new Set());
    };

    const bulkCleanOrphaned = async () => {
        if (selectedOrphaned.size === 0) return;
        setDeleting(true);
        const items = filteredOrphaned.filter((i) =>
            selectedOrphaned.has(i.id)
        );

        const BATCH_SIZE = 10;
        const cleanedItems: Record<string, Partial<Item>> = {};

        onLogsUpdate(`📋 Очистка ${items.length} висячих меток...`);
        if (!drawerOpen) setNewLogsCount((c) => c + 1);

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(items.length / BATCH_SIZE);

            onLogsUpdate(
                `🔄 Батч ${batchNum}/${totalBatches} (${batch.length} элементов)...`
            );
            if (!drawerOpen) setNewLogsCount((c) => c + 1);

            const results = await Promise.allSettled(
                batch.map(async (item) => {
                    const originalItem = result.items[item.id];
                    if (!originalItem) return `⚠️ ${item.name}: не найден`;

                    const propsToDelete: string[] = [];
                    if (originalItem.properties.is_copied)
                        propsToDelete.push('is_copied');
                    if (originalItem.properties.copy_item_id)
                        propsToDelete.push('copy_item_id');
                    if (originalItem.properties.original_item_id)
                        propsToDelete.push('original_item_id');

                    try {
                        for (const prop of propsToDelete) {
                            await invoke('delete_property', {
                                itemId: item.id,
                                propertyName: prop,
                            });
                        }

                        // Обновляем локальный объект
                        const updatedProps = { ...originalItem.properties };
                        propsToDelete.forEach((p) => delete updatedProps[p]);
                        cleanedItems[item.id] = { properties: updatedProps };

                        return `✅ ${originalItem.name}`;
                    } catch (e: any) {
                        return `❌ ${originalItem.name}: ${e}`;
                    }
                })
            );

            results.forEach((r) => {
                const msg =
                    r.status === 'fulfilled' ? r.value : `❌ ${r.reason}`;
                onLogsUpdate(msg);
                if (!drawerOpen) setNewLogsCount((c) => c + 1);
            });

            const done = results.filter(
                (r) => r.status === 'fulfilled' && r.value?.startsWith('✅')
            ).length;
            const failed = batch.length - done;
            onLogsUpdate(`📊 Батч ${batchNum}: ✅ ${done} / ❌ ${failed}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        }

        onLogsUpdate(
            `✨ Готово. Очищено: ${Object.keys(cleanedItems).length} элементов`
        );
        if (!drawerOpen) setNewLogsCount((c) => c + 1);

        // КРИТИЧНО: обновляем стейт — применяем изменения properties
        onResultUpdate({
            ...result,
            items: {
                ...result.items,
                ...Object.fromEntries(
                    Object.entries(cleanedItems).map(([id, updates]) => [
                        id,
                        { ...result.items[id], ...updates },
                    ])
                ),
            },
        });

        setDeleting(false);
        setSelectedOrphaned(new Set());
    };
    return (
        <Box>
            {/* Фильтры */}
            <Card sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <LogDrawer
                        logs={logs}
                        isOpen={drawerOpen}
                        onOpen={() => {
                            setDrawerOpen(true);
                            setNewLogsCount(0);
                        }}
                        onClose={() => setDrawerOpen(false)}
                        newLogsCount={newLogsCount}
                    />
                </Box>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 2fr 1fr',
                        gap: 2,
                    }}
                >
                    <TextField
                        placeholder='Имя файла...'
                        value={searchName}
                        onChange={(e) => setSearchName(e.target.value)}
                        size='small'
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position='start'>
                                    <SearchIcon />
                                </InputAdornment>
                            ),
                        }}
                    />
                    <TextField
                        placeholder='Путь...'
                        value={searchPath}
                        onChange={(e) => setSearchPath(e.target.value)}
                        size='small'
                    />
                    <Select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все типы</MenuItem>
                        <MenuItem value='folder'>📁 Папки</MenuItem>
                        <MenuItem value='file'>📄 Файлы</MenuItem>
                    </Select>
                </Box>
            </Card>

            <Card>
                {/* Сабтабы */}
                <Tabs
                    value={subTab}
                    onChange={(_, v) => setSubTab(v)}
                    sx={{
                        borderBottom: 1,
                        borderColor: 'divider',
                        px: 2,
                        '& .MuiTab-root': {
                            textTransform: 'none',
                            fontWeight: 600,
                        },
                    }}
                >
                    <Tab
                        label={`🔗 Оригиналы с копиями (${filteredLinked.length})`}
                        value='linked'
                        sx={{
                            color:
                                filteredLinked.length > 0
                                    ? 'error.main'
                                    : undefined,
                        }}
                    />
                    <Tab
                        label={`👻 Висячие метки (${filteredOrphaned.length})`}
                        value='orphaned'
                        sx={{
                            color:
                                filteredOrphaned.length > 0
                                    ? 'warning.main'
                                    : undefined,
                        }}
                    />
                </Tabs>

                <Box sx={{ p: 2 }}>
                    {/* Тулбар с кнопками */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            mb: 2,
                        }}
                    >
                        <Box sx={{ flex: 1 }} />
                        {subTab === 'linked' ? (
                            <>
                                {selectedLinked.size > 0 && (
                                    <>
                                        <Button
                                            variant='contained'
                                            color='error'
                                            startIcon={<DeleteSweepIcon />}
                                            onClick={bulkDeleteLinked}
                                            disabled={deleting}
                                            sx={{
                                                textTransform: 'none',
                                                fontWeight: 600,
                                            }}
                                        >
                                            {deleting
                                                ? 'Удаление...'
                                                : `Удалить оригиналы (${selectedLinked.size})`}
                                        </Button>
                                        <Button
                                            variant='outlined'
                                            size='small'
                                            onClick={() =>
                                                setSelectedLinked(new Set())
                                            }
                                        >
                                            Снять
                                        </Button>
                                    </>
                                )}
                                <Button
                                    variant='outlined'
                                    size='small'
                                    onClick={() =>
                                        setSelectedLinked(
                                            new Set(
                                                filteredLinked.map((i) => i.id)
                                            )
                                        )
                                    }
                                >
                                    Выделить все
                                </Button>
                            </>
                        ) : (
                            <>
                                {selectedOrphaned.size > 0 && (
                                    <>
                                        <Button
                                            variant='contained'
                                            color='warning'
                                            startIcon={<DeleteIcon />}
                                            onClick={bulkCleanOrphaned}
                                            disabled={deleting}
                                            sx={{
                                                textTransform: 'none',
                                                fontWeight: 600,
                                            }}
                                        >
                                            {deleting
                                                ? 'Очистка...'
                                                : `Очистить метки (${selectedOrphaned.size})`}
                                        </Button>
                                        <Button
                                            variant='outlined'
                                            size='small'
                                            onClick={() =>
                                                setSelectedOrphaned(new Set())
                                            }
                                        >
                                            Снять
                                        </Button>
                                    </>
                                )}
                                <Button
                                    variant='outlined'
                                    size='small'
                                    onClick={() =>
                                        setSelectedOrphaned(
                                            new Set(
                                                filteredOrphaned.map(
                                                    (i) => i.id
                                                )
                                            )
                                        )
                                    }
                                >
                                    Выделить все
                                </Button>
                            </>
                        )}
                    </Box>

                    {/* Контент сабтаба */}
                    <Box sx={{ height: 500 }}>
                        {subTab === 'linked' ? (
                            filteredLinked.length === 0 ? (
                                <Box
                                    sx={{
                                        p: 4,
                                        textAlign: 'center',
                                        color: 'text.secondary',
                                    }}
                                >
                                    <Typography variant='h6'>
                                        ✅ Нет оригиналов для удаления
                                    </Typography>
                                </Box>
                            ) : (
                                <AutoSizer>
                                    {({ height, width }) => (
                                        <VirtualList
                                            height={height}
                                            width={width}
                                            rowCount={filteredLinked.length}
                                            rowHeight={100}
                                            rowRenderer={({
                                                index,
                                                key,
                                                style,
                                            }) => {
                                                const item =
                                                    filteredLinked[index];
                                                const isSelected =
                                                    selectedLinked.has(item.id);
                                                const originalItem =
                                                    result.items[item.id];

                                                return (
                                                    <div
                                                        key={key}
                                                        style={style}
                                                    >
                                                        <Paper
                                                            variant='outlined'
                                                            sx={{
                                                                m: 1,
                                                                p: 1.5,
                                                                display: 'flex',
                                                                alignItems:
                                                                    'center',
                                                                gap: 2,
                                                                cursor: 'pointer',
                                                                bgcolor:
                                                                    isSelected
                                                                        ? alpha(
                                                                              '#f44336',
                                                                              0.1
                                                                          )
                                                                        : 'transparent',
                                                                borderColor:
                                                                    isSelected
                                                                        ? 'error.main'
                                                                        : 'divider',
                                                                transition:
                                                                    'all 0.2s',
                                                                '&:hover': {
                                                                    bgcolor:
                                                                        alpha(
                                                                            '#f44336',
                                                                            0.05
                                                                        ),
                                                                    borderColor:
                                                                        'error.main',
                                                                },
                                                            }}
                                                            onClick={() => {
                                                                setSelectedLinked(
                                                                    (prev) => {
                                                                        const next =
                                                                            new Set(
                                                                                prev
                                                                            );
                                                                        next.has(
                                                                            item.id
                                                                        )
                                                                            ? next.delete(
                                                                                  item.id
                                                                              )
                                                                            : next.add(
                                                                                  item.id
                                                                              );
                                                                        return next;
                                                                    }
                                                                );
                                                            }}
                                                        >
                                                            <Checkbox
                                                                checked={
                                                                    isSelected
                                                                }
                                                                color='error'
                                                            />
                                                            <Typography
                                                                sx={{
                                                                    fontSize: 24,
                                                                }}
                                                            >
                                                                {item.type ===
                                                                'folder'
                                                                    ? '📁'
                                                                    : '📄'}
                                                            </Typography>
                                                            <Box
                                                                sx={{
                                                                    flex: 1,
                                                                    minWidth: 0,
                                                                }}
                                                            >
                                                                <Typography
                                                                    sx={{
                                                                        fontWeight: 600,
                                                                        overflow:
                                                                            'hidden',
                                                                        textOverflow:
                                                                            'ellipsis',
                                                                        whiteSpace:
                                                                            'nowrap',
                                                                    }}
                                                                >
                                                                    {item.name}
                                                                </Typography>
                                                                <Typography
                                                                    variant='caption'
                                                                    color='text.secondary'
                                                                >
                                                                    {item.path ||
                                                                        'Корень'}
                                                                </Typography>
                                                                {/* Чипы меток */}
                                                                <Box
                                                                    sx={{
                                                                        display:
                                                                            'flex',
                                                                        gap: 0.5,
                                                                        mt: 0.5,
                                                                        flexWrap:
                                                                            'wrap',
                                                                    }}
                                                                >
                                                                    {originalItem
                                                                        ?.properties
                                                                        .is_copied ===
                                                                        'true' && (
                                                                        <Chip
                                                                            label='is_copied'
                                                                            size='small'
                                                                            color='error'
                                                                            variant='outlined'
                                                                            sx={{
                                                                                height: 18,
                                                                                fontSize: 10,
                                                                            }}
                                                                        />
                                                                    )}
                                                                    {originalItem
                                                                        ?.properties
                                                                        .copy_item_id && (
                                                                        <Chip
                                                                            label={`copy → ${originalItem.properties.copy_item_id.slice(0, 8)}...`}
                                                                            size='small'
                                                                            color='error'
                                                                            variant='outlined'
                                                                            sx={{
                                                                                height: 18,
                                                                                fontSize: 10,
                                                                            }}
                                                                        />
                                                                    )}
                                                                    {originalItem
                                                                        ?.properties
                                                                        .original_item_id && (
                                                                        <Chip
                                                                            label={`orig → ${originalItem.properties.original_item_id.slice(0, 8)}...`}
                                                                            size='small'
                                                                            variant='outlined'
                                                                            sx={{
                                                                                height: 18,
                                                                                fontSize: 10,
                                                                            }}
                                                                        />
                                                                    )}
                                                                </Box>
                                                            </Box>
                                                            <Chip
                                                                label='Оригинал'
                                                                size='small'
                                                                color='error'
                                                                icon={
                                                                    <DeleteIcon />
                                                                }
                                                                sx={{
                                                                    fontWeight: 600,
                                                                }}
                                                            />
                                                            <Tooltip title='Удалить оригинал'>
                                                                <IconButton
                                                                    size='small'
                                                                    color='error'
                                                                    onClick={(
                                                                        e
                                                                    ) => {
                                                                        e.stopPropagation();
                                                                        deleteOriginal(
                                                                            item.id,
                                                                            item.copyId
                                                                        );
                                                                    }}
                                                                >
                                                                    <DeleteSweepIcon fontSize='small' />
                                                                </IconButton>
                                                            </Tooltip>
                                                        </Paper>
                                                    </div>
                                                );
                                            }}
                                        />
                                    )}
                                </AutoSizer>
                            )
                        ) : filteredOrphaned.length === 0 ? (
                            <Box
                                sx={{
                                    p: 4,
                                    textAlign: 'center',
                                    color: 'text.secondary',
                                }}
                            >
                                <Typography variant='h6'>
                                    ✅ Нет висячих меток
                                </Typography>
                            </Box>
                        ) : (
                            <AutoSizer>
                                {({ height, width }) => (
                                    <VirtualList
                                        height={height}
                                        width={width}
                                        rowCount={filteredOrphaned.length}
                                        rowHeight={100}
                                        rowRenderer={({
                                            index,
                                            key,
                                            style,
                                        }) => {
                                            const item =
                                                filteredOrphaned[index];
                                            const isSelected =
                                                selectedOrphaned.has(item.id);
                                            const originalItem =
                                                result.items[item.id];

                                            return (
                                                <div
                                                    key={key}
                                                    style={style}
                                                >
                                                    <Paper
                                                        variant='outlined'
                                                        sx={{
                                                            m: 1,
                                                            p: 1.5,
                                                            display: 'flex',
                                                            alignItems:
                                                                'center',
                                                            gap: 2,
                                                            cursor: 'pointer',
                                                            bgcolor: isSelected
                                                                ? alpha(
                                                                      '#ff9800',
                                                                      0.1
                                                                  )
                                                                : 'transparent',
                                                            borderColor:
                                                                isSelected
                                                                    ? 'warning.main'
                                                                    : 'divider',
                                                            transition:
                                                                'all 0.2s',
                                                            '&:hover': {
                                                                bgcolor: alpha(
                                                                    '#ff9800',
                                                                    0.05
                                                                ),
                                                                borderColor:
                                                                    'warning.main',
                                                            },
                                                        }}
                                                        onClick={() => {
                                                            setSelectedOrphaned(
                                                                (prev) => {
                                                                    const next =
                                                                        new Set(
                                                                            prev
                                                                        );
                                                                    next.has(
                                                                        item.id
                                                                    )
                                                                        ? next.delete(
                                                                              item.id
                                                                          )
                                                                        : next.add(
                                                                              item.id
                                                                          );
                                                                    return next;
                                                                }
                                                            );
                                                        }}
                                                    >
                                                        <Checkbox
                                                            checked={isSelected}
                                                            color='warning'
                                                        />
                                                        <Typography
                                                            sx={{
                                                                fontSize: 24,
                                                            }}
                                                        >
                                                            {item.type ===
                                                            'folder'
                                                                ? '📁'
                                                                : '📄'}
                                                        </Typography>
                                                        <Box
                                                            sx={{
                                                                flex: 1,
                                                                minWidth: 0,
                                                            }}
                                                        >
                                                            <Typography
                                                                sx={{
                                                                    fontWeight: 600,
                                                                    overflow:
                                                                        'hidden',
                                                                    textOverflow:
                                                                        'ellipsis',
                                                                    whiteSpace:
                                                                        'nowrap',
                                                                }}
                                                            >
                                                                {item.name}
                                                            </Typography>
                                                            <Typography
                                                                variant='caption'
                                                                color='text.secondary'
                                                            >
                                                                {item.path ||
                                                                    'Корень'}
                                                            </Typography>
                                                            {/* Чипы меток */}
                                                            <Box
                                                                sx={{
                                                                    display:
                                                                        'flex',
                                                                    gap: 0.5,
                                                                    mt: 0.5,
                                                                    flexWrap:
                                                                        'wrap',
                                                                }}
                                                            >
                                                                {originalItem
                                                                    ?.properties
                                                                    .is_copied ===
                                                                    'true' && (
                                                                    <Chip
                                                                        label='is_copied'
                                                                        size='small'
                                                                        color='warning'
                                                                        variant='outlined'
                                                                        sx={{
                                                                            height: 18,
                                                                            fontSize: 10,
                                                                        }}
                                                                    />
                                                                )}
                                                                {originalItem
                                                                    ?.properties
                                                                    .copy_item_id && (
                                                                    <Chip
                                                                        label={`copy → ${originalItem.properties.copy_item_id.slice(0, 8)}...`}
                                                                        size='small'
                                                                        color='warning'
                                                                        variant='outlined'
                                                                        sx={{
                                                                            height: 18,
                                                                            fontSize: 10,
                                                                        }}
                                                                    />
                                                                )}
                                                                {originalItem
                                                                    ?.properties
                                                                    .original_item_id && (
                                                                    <Chip
                                                                        label={`orig → ${originalItem.properties.original_item_id.slice(0, 8)}...`}
                                                                        size='small'
                                                                        color='warning'
                                                                        variant='outlined'
                                                                        sx={{
                                                                            height: 18,
                                                                            fontSize: 10,
                                                                        }}
                                                                    />
                                                                )}
                                                            </Box>
                                                        </Box>
                                                        <Chip
                                                            label='Метки'
                                                            size='small'
                                                            color='warning'
                                                            icon={<CopyIcon />}
                                                            sx={{
                                                                fontWeight: 600,
                                                            }}
                                                        />
                                                        <Tooltip title='Очистить метки'>
                                                            <IconButton
                                                                size='small'
                                                                color='warning'
                                                                onClick={(
                                                                    e
                                                                ) => {
                                                                    e.stopPropagation();
                                                                    cleanOrphanedProperties(
                                                                        item.id
                                                                    );
                                                                }}
                                                            >
                                                                <DeleteIcon fontSize='small' />
                                                            </IconButton>
                                                        </Tooltip>
                                                    </Paper>
                                                </div>
                                            );
                                        }}
                                    />
                                )}
                            </AutoSizer>
                        )}
                    </Box>
                </Box>
            </Card>
        </Box>
    );
};

export default CopiedItemsView;
