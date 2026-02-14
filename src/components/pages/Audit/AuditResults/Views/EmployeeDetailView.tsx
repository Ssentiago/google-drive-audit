import { useMemo, useState } from 'react';
import {
    AccessDetail,
    AuditResult,
    Item,
    Permission,
    UndeletedOriginal,
} from '../../types/interfaces.ts';
import { invoke } from '@tauri-apps/api/core';
import {
    alpha,
    Box,
    Button,
    Card,
    Checkbox,
    Chip,
    IconButton,
    MenuItem,
    Paper,
    Select,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    ArrowBack,
    ContentCopy,
    Delete,
    DeleteSweep,
} from '@mui/icons-material';
import LogDrawer from '../../../../common/LogDrawer.tsx';
import { AutoSizer, List as VirtualList } from 'react-virtualized';

const EmployeeDetailView: React.FC<{
    email: string;
    result: AuditResult;
    onBack: () => void;
    onLogsUpdate: (msg: string) => void;
    logs: string[];
    onResultUpdate: (result: AuditResult) => void;
}> = ({ email, result, onBack, onLogsUpdate, logs, onResultUpdate }) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [searchName, setSearchName] = useState('');
    const [searchPath, setSearchPath] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'name' | 'role' | 'path'>('role');
    const [loading, setLoading] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);

    const accesses = useMemo((): AccessDetail[] => {
        const entries = result.emailIndex[email] || [];
        return entries
            .map(([itemId, permIdx]) => {
                const item = result.items[itemId];
                if (!item) return null;
                const perm = item.permissions[permIdx];
                if (!perm) return null;

                // ПРОПУСКАЕМ если владелец И уже скопирован
                if (
                    perm.role === 'owner' &&
                    item.properties.is_copied === 'true'
                ) {
                    return null;
                }

                return {
                    itemId,
                    itemName: item.name,
                    itemType: item.mimeType.includes('folder')
                        ? 'folder'
                        : 'file',
                    path: item.path,
                    role: perm.role,
                    permissionId: perm.permissionId,
                    isOwner: perm.role === 'owner',
                    parentId: item.parentId,
                };
            })
            .filter(Boolean) as AccessDetail[];
    }, [email, result]);

    const filtered = useMemo(() => {
        let list = accesses.filter((acc) => {
            const matchName =
                searchName === '' ||
                acc.itemName.toLowerCase().includes(searchName.toLowerCase());
            const matchPath =
                searchPath === '' ||
                acc.path.toLowerCase().includes(searchPath.toLowerCase());
            const matchRole =
                roleFilter === 'all' ||
                (roleFilter === 'owner' && acc.role === 'owner') ||
                (roleFilter === 'editor' && acc.role === 'editor') ||
                (roleFilter === 'viewer' && acc.role === 'viewer') ||
                (roleFilter === 'commenter' && acc.role === 'commenter');
            const matchType =
                typeFilter === 'all' ||
                (typeFilter === 'folder' && acc.itemType === 'folder') ||
                (typeFilter === 'file' && acc.itemType === 'file');

            return matchName && matchPath && matchRole && matchType;
        });

        if (sortBy === 'name') {
            list.sort((a, b) => a.itemName.localeCompare(b.itemName));
        } else if (sortBy === 'path') {
            list.sort((a, b) => a.path.localeCompare(b.path));
        } else if (sortBy === 'role') {
            const priority = {
                owner: 0,
                editor: 1,
                commenter: 2,
                viewer: 3,
            } as any;
            list.sort((a, b) => priority[a.role] - priority[b.role]);
        }

        return list;
    }, [accesses, searchName, searchPath, roleFilter, typeFilter, sortBy]);

    const toggleItem = (itemId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId);
            else next.add(itemId);
            return next;
        });
    };

    const selectAll = () => {
        setSelected(new Set(filtered.map((a) => a.itemId)));
    };

    const clearSelection = () => {
        setSelected(new Set());
    };

    const removeFromLocal = (itemId: string) => {
        onResultUpdate({
            ...result,
            emailIndex: {
                ...result.emailIndex,
                [email]: (result.emailIndex[email] || []).filter(
                    ([id]) => id !== itemId
                ),
            },
        });
    };

    const cleanupCascaded = async (
        deletedItemId: string,
        deletedItemPath: string
    ) => {
        const entries = result.emailIndex[email] || [];
        const affected = entries.filter(([itemId]) => {
            if (itemId === deletedItemId) return false;
            const item = result.items[itemId];
            if (!item) return false;
            return item.path.startsWith(deletedItemPath);
        });

        if (affected.length === 0) return;

        const CHUNK_SIZE = 5;
        const toRemove = new Set<string>();

        for (let i = 0; i < affected.length; i += CHUNK_SIZE) {
            const chunk = affected.slice(i, i + CHUNK_SIZE);

            const results = await Promise.all(
                chunk.map(async ([itemId, permIdx]) => {
                    const item = result.items[itemId];
                    if (!item) return itemId;
                    const perm = item.permissions[permIdx];
                    if (!perm) return itemId;

                    try {
                        const exists = await invoke<boolean>('is_perm_exists', {
                            fileId: itemId,
                            permId: perm.permissionId,
                        });
                        return exists ? null : itemId;
                    } catch {
                        return null;
                    }
                })
            );

            results.forEach((id) => {
                if (id) toRemove.add(id);
            });

            // Пауза между чанками кроме последнего
            if (i + CHUNK_SIZE < affected.length) {
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
        }

        if (toRemove.size === 0) return;

        onLogsUpdate(`🧹 Каскадно убрано ${toRemove.size} доступов`);

        onResultUpdate({
            ...result,
            emailIndex: {
                ...result.emailIndex,
                [email]: (result.emailIndex[email] || []).filter(
                    ([id]) => !toRemove.has(id)
                ),
            },
        });
    };

    const removePermission = async (itemId: string, permissionId: string) => {
        try {
            await invoke('remove_permission', { fileId: itemId, permissionId });
            onLogsUpdate(`✅ Удалено разрешение для ${itemId}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);

            const item = result.items[itemId];
            removeFromLocal(itemId);

            // #1 Проверяем каскад если это была папка
            if (
                item?.mimeType === 'folder' ||
                item?.mimeType?.includes('folder')
            ) {
                await cleanupCascaded(itemId, item.path);
            }
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка: ${e} — убираем из списка`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
            removeFromLocal(itemId);
        }
    };
    const copyAndClean = async (
        itemId: string,
        itemName: string,
        parentId: string,
        suspiciousEmails: string[]
    ) => {
        try {
            setLoading(true);
            const copyInfo = await invoke<UndeletedOriginal>('copy_and_clean', {
                itemId,
                name: itemName,
                parentId,
                suspiciousEmails,
            });
            console.log('=== COPY INFO FROM BACKEND ===', copyInfo);
            console.log('copy_id:', copyInfo.copyId);

            onLogsUpdate(`✅ Создана копия: ${itemName}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);

            // Обновляем проперти оригинала
            const originalItem = result.items[itemId];

            if (originalItem) {
                onResultUpdate({
                    ...result,
                    items: {
                        ...result.items,
                        [itemId]: {
                            ...originalItem,
                            properties: {
                                ...originalItem.properties,
                                is_copied: 'true',
                                copy_item_id: copyInfo.copyId,
                            },
                        },
                    },
                    emailIndex: {
                        ...result.emailIndex,
                        [email]: (result.emailIndex[email] || []).filter(
                            ([id]) => id !== itemId
                        ),
                    },
                });
            }
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка копирования: ${e}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        } finally {
            setLoading(false);
        }
    };
    const bulkProcess = async () => {
        if (selected.size === 0) return;
        setLoading(true);

        // Сортируем: сначала файлы, потом папки от глубоких к корневым
        const items = filtered
            .filter((a) => selected.has(a.itemId))
            .sort((a, b) => {
                // Сначала файлы, потом папки
                if (a.itemType !== b.itemType) {
                    return a.itemType === 'file' ? -1 : 1;
                }

                // Папки: чем глубже путь (больше '/'), тем раньше обработать
                if (a.itemType === 'folder' && b.itemType === 'folder') {
                    const depthA = (a.path.match(/\//g) || []).length;
                    const depthB = (b.path.match(/\//g) || []).length;
                    return depthB - depthA; // от глубоких к корневым
                }

                return 0;
            });

        const BATCH_SIZE = 20;
        const totalBatches = Math.ceil(items.length / BATCH_SIZE);

        onLogsUpdate(
            `📋 Всего элементов: ${items.length}, батчей: ${totalBatches}`
        );
        if (!drawerOpen) setNewLogsCount((c) => c + 1);

        const toRemoveFromIndex = new Set<string>();
        const itemUpdates: Record<string, Partial<Item>> = {};

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;

            onLogsUpdate(
                `\n🔄 Батч ${batchNum}/${totalBatches} (${batch.length} элементов)...`
            );
            if (!drawerOpen) setNewLogsCount((c) => c + 1);

            const results = await Promise.allSettled(
                batch.map(async (acc) => {
                    try {
                        if (acc.isOwner) {
                            const copyInfo = await invoke<UndeletedOriginal>(
                                'copy_and_clean',
                                {
                                    itemId: acc.itemId,
                                    name: acc.itemName,
                                    parentId: acc.parentId || '',
                                    suspiciousEmails: [email],
                                }
                            );

                            toRemoveFromIndex.add(acc.itemId);
                            itemUpdates[acc.itemId] = {
                                properties: {
                                    ...result.items[acc.itemId]?.properties,
                                    is_copied: 'true',
                                    copy_item_id: copyInfo.copyId,
                                },
                            };

                            return `✅ Копия: ${acc.itemName}`;
                        } else {
                            await invoke('remove_permission', {
                                fileId: acc.itemId,
                                permissionId: acc.permissionId,
                            });

                            toRemoveFromIndex.add(acc.itemId);

                            // Каскад для папок
                            if (acc.itemType === 'folder') {
                                (result.emailIndex[email] || []).forEach(
                                    ([itemId]) => {
                                        if (itemId === acc.itemId) return;
                                        const item = result.items[itemId];
                                        if (item?.path.startsWith(acc.path)) {
                                            toRemoveFromIndex.add(itemId);
                                        }
                                    }
                                );
                            }

                            return `✅ Удалено: ${acc.itemName}`;
                        }
                    } catch (e: any) {
                        toRemoveFromIndex.add(acc.itemId);
                        return `❌ ${acc.itemName}: ${e}`;
                    }
                })
            );

            results.forEach((r) => {
                const msg =
                    r.status === 'fulfilled'
                        ? r.value
                        : `❌ Unexpected: ${r.reason}`;
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
            `\n✨ Готово. Обработано: ${toRemoveFromIndex.size} элементов`
        );
        if (!drawerOpen) setNewLogsCount((c) => c + 1);

        onResultUpdate({
            ...result,
            items: {
                ...result.items,
                ...Object.fromEntries(
                    Object.entries(itemUpdates).map(([id, updates]) => [
                        id,
                        { ...result.items[id], ...updates },
                    ])
                ),
            },
            emailIndex: {
                ...result.emailIndex,
                [email]: (result.emailIndex[email] || []).filter(
                    ([id]) => !toRemoveFromIndex.has(id)
                ),
            },
        });

        setLoading(false);
        clearSelection();
    };

    const roleToRu = (role: Permission['role']) => {
        return {
            owner: '👑 Владелец',
            organizer: '🔧 Организатор',
            fileOrganizer: '📁 Орг. файлов',
            editor: '✏️ Редактор',
            commenter: '💬 Комментатор',
            viewer: '👁️ Просмотр',
        }[role];
    };

    return (
        <Box>
            <Card sx={{ p: 2, mb: 2 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        mb: 2,
                    }}
                >
                    <IconButton onClick={onBack}>
                        <ArrowBack />
                    </IconButton>
                    <Box sx={{ flex: 1 }}>
                        <Typography
                            variant='h6'
                            sx={{ fontWeight: 600, fontFamily: 'monospace' }}
                        >
                            {email}
                        </Typography>
                        <Typography
                            variant='body2'
                            color='text.secondary'
                        >
                            {accesses.length} доступов
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {selected.size > 0 && (
                            <>
                                <Button
                                    variant='contained'
                                    color='error'
                                    size='small'
                                    onClick={bulkProcess}
                                    disabled={loading}
                                    startIcon={<DeleteSweep />}
                                >
                                    {loading
                                        ? 'Обработка...'
                                        : `Обработать (${selected.size})`}
                                </Button>
                                <Button
                                    variant='outlined'
                                    size='small'
                                    onClick={clearSelection}
                                >
                                    Снять
                                </Button>
                            </>
                        )}
                        <Button
                            variant='outlined'
                            size='small'
                            onClick={selectAll}
                        >
                            Выделить все
                        </Button>
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
                </Box>

                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: 2,
                    }}
                >
                    <TextField
                        placeholder='Имя файла...'
                        value={searchName}
                        onChange={(e) => setSearchName(e.target.value)}
                        size='small'
                    />
                    <TextField
                        placeholder='Путь...'
                        value={searchPath}
                        onChange={(e) => setSearchPath(e.target.value)}
                        size='small'
                    />
                    <Select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все роли</MenuItem>
                        <MenuItem value='owner'>👑 Владельцы</MenuItem>
                        <MenuItem value='editor'>✏️ Редакторы</MenuItem>
                        <MenuItem value='commenter'>💬 Комментаторы</MenuItem>
                        <MenuItem value='viewer'>👁️ Просмотр</MenuItem>
                    </Select>
                    <Select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все типы</MenuItem>
                        <MenuItem value='folder'>📁 Папки</MenuItem>
                        <MenuItem value='file'>📄 Файлы</MenuItem>
                    </Select>
                    <Select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        size='small'
                    >
                        <MenuItem value='role'>По критичности</MenuItem>
                        <MenuItem value='name'>По имени</MenuItem>
                        <MenuItem value='path'>По пути</MenuItem>
                    </Select>
                </Box>
            </Card>

            <Card sx={{ height: 'calc(100vh - 400px)' }}>
                {filtered.length === 0 ? (
                    <Box
                        sx={{
                            p: 4,
                            textAlign: 'center',
                            color: 'text.secondary',
                        }}
                    >
                        <Typography>Ничего не найдено</Typography>
                    </Box>
                ) : (
                    <AutoSizer>
                        {({ height, width }) => (
                            <VirtualList
                                height={height}
                                width={width}
                                rowCount={filtered.length}
                                rowHeight={100}
                                rowRenderer={({ index, key, style }) => {
                                    const acc = filtered[index];
                                    const isSelected = selected.has(acc.itemId);

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
                                                    alignItems: 'center',
                                                    gap: 2,
                                                    cursor: 'pointer',
                                                    bgcolor: isSelected
                                                        ? alpha('#1976d2', 0.1)
                                                        : 'transparent',
                                                    borderColor: isSelected
                                                        ? 'primary.main'
                                                        : 'divider',
                                                    transition: 'all 0.2s',
                                                    '&:hover': {
                                                        bgcolor: alpha(
                                                            '#1976d2',
                                                            0.05
                                                        ),
                                                        borderColor:
                                                            'primary.main',
                                                    },
                                                }}
                                                onClick={() =>
                                                    toggleItem(acc.itemId)
                                                }
                                            >
                                                <Checkbox
                                                    checked={isSelected}
                                                />
                                                <Typography
                                                    sx={{ fontSize: 24 }}
                                                >
                                                    {acc.itemType === 'folder'
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
                                                            overflow: 'hidden',
                                                            textOverflow:
                                                                'ellipsis',
                                                            whiteSpace:
                                                                'nowrap',
                                                        }}
                                                    >
                                                        {acc.itemName}
                                                    </Typography>
                                                    <Typography
                                                        variant='caption'
                                                        color='text.secondary'
                                                    >
                                                        {acc.path || 'Корень'}
                                                    </Typography>
                                                </Box>
                                                <Chip
                                                    label={roleToRu(acc.role)}
                                                    size='small'
                                                    color={
                                                        acc.role === 'owner'
                                                            ? 'error'
                                                            : acc.role ===
                                                                'editor'
                                                              ? 'warning'
                                                              : acc.role ===
                                                                  'commenter'
                                                                ? 'secondary'
                                                                : 'info'
                                                    }
                                                    sx={{ fontWeight: 600 }}
                                                />
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        gap: 0.5,
                                                    }}
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                >
                                                    {!acc.isOwner ? (
                                                        <Tooltip title='Удалить разрешение'>
                                                            <IconButton
                                                                size='small'
                                                                color='error'
                                                                onClick={() =>
                                                                    removePermission(
                                                                        acc.itemId,
                                                                        acc.permissionId
                                                                    )
                                                                }
                                                            >
                                                                <Delete fontSize='small' />
                                                            </IconButton>
                                                        </Tooltip>
                                                    ) : (
                                                        <Tooltip title='Копировать и очистить'>
                                                            <IconButton
                                                                size='small'
                                                                color='primary'
                                                                onClick={() =>
                                                                    copyAndClean(
                                                                        acc.itemId,
                                                                        acc.itemName,
                                                                        acc.parentId ||
                                                                            '',
                                                                        [email]
                                                                    )
                                                                }
                                                            >
                                                                <ContentCopy fontSize='small' />
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                </Box>
                                            </Paper>
                                        </div>
                                    );
                                }}
                            />
                        )}
                    </AutoSizer>
                )}
            </Card>
        </Box>
    );
};

export default EmployeeDetailView;
