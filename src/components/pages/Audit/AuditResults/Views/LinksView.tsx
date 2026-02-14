import React, { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    alpha,
    Box,
    Button,
    Card,
    Chip,
    IconButton,
    InputAdornment,
    MenuItem,
    Paper,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { Delete, Description, Search, SwapVert } from '@mui/icons-material';
import { AuditResult } from '../../types/interfaces.ts';
import { AutoSizer, List as VirtualList } from 'react-virtualized';

type SortField = 'name' | 'path' | 'type' | 'role' | 'owner';
type SortOrder = 'asc' | 'desc';

const LinksView: React.FC<{
    result: AuditResult;
    onLogsUpdate: (msg: string) => void;
}> = ({ result, onLogsUpdate }) => {
    const [searchPath, setSearchPath] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [ownerFilter, setOwnerFilter] = useState<string>('all');
    const [sortField, setSortField] = useState<SortField>('path');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    const [exporting, setExporting] = useState(false);

    const roleToApi = (role: string): string => {
        const map: Record<string, string> = {
            Owner: 'owner',
            Organizer: 'organizer',
            FileOrganizer: 'fileOrganizer',
            Editor: 'writer',
            Commenter: 'commenter',
            Viewer: 'reader',
        };
        return map[role] || 'reader';
    };

    // Собираем ссылки + владельцев
    const links = useMemo(() => {
        const linkEntries = result.emailIndex['__link__'] || [];
        return linkEntries
            .map(([itemId, permIdx]) => {
                const item = result.items[itemId];
                if (!item) return null;
                const perm = item.permissions[permIdx];
                if (!perm || !perm.isLink) return null;

                // Находим owner
                const ownerPerm = item.permissions.find(
                    (p) => p.role === 'owner' || p.role === 'organizer'
                );
                const ownerEmail = ownerPerm?.email || 'unknown';

                return {
                    itemId,
                    itemName: item.name,
                    itemType: item.mimeType.includes('folder')
                        ? 'folder'
                        : 'file',
                    path: item.path,
                    role: roleToApi(perm.role),
                    permissionId: perm.permissionId,
                    ownerEmail,
                };
            })
            .filter(Boolean) as any[];
    }, [result]);

    // Список уникальных владельцев для фильтра
    const uniqueOwners = useMemo(() => {
        const owners = new Set(links.map((l) => l.ownerEmail));
        return Array.from(owners).sort();
    }, [links]);

    // Фильтрация
    const filtered = useMemo(() => {
        return links.filter((link) => {
            const matchPath =
                searchPath === '' ||
                link.path.toLowerCase().includes(searchPath.toLowerCase()) ||
                link.itemName.toLowerCase().includes(searchPath.toLowerCase());
            const matchRole = roleFilter === 'all' || link.role === roleFilter;
            const matchType =
                typeFilter === 'all' ||
                (typeFilter === 'folder' && link.itemType === 'folder') ||
                (typeFilter === 'file' && link.itemType === 'file');
            const matchOwner =
                ownerFilter === 'all' || link.ownerEmail === ownerFilter;

            return matchPath && matchRole && matchType && matchOwner;
        });
    }, [links, searchPath, roleFilter, typeFilter, ownerFilter]);

    // Сортировка
    const sorted = useMemo(() => {
        const copy = [...filtered];
        copy.sort((a, b) => {
            let aVal: any, bVal: any;

            switch (sortField) {
                case 'name':
                    aVal = a.itemName.toLowerCase();
                    bVal = b.itemName.toLowerCase();
                    break;
                case 'path':
                    aVal = a.path.toLowerCase();
                    bVal = b.path.toLowerCase();
                    break;
                case 'type':
                    aVal = a.itemType;
                    bVal = b.itemType;
                    break;
                case 'role':
                    aVal = a.role;
                    bVal = b.role;
                    break;
                case 'owner':
                    aVal = a.ownerEmail.toLowerCase();
                    bVal = b.ownerEmail.toLowerCase();
                    break;
            }

            if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
        return copy;
    }, [filtered, sortField, sortOrder]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
    };

    const updateLinkRole = async (
        itemId: string,
        permissionId: string,
        newRole: string
    ) => {
        try {
            await invoke('update_link_access', {
                itemId,
                permissionId,
                newRole,
            });
            onLogsUpdate(`✅ Обновлён доступ по ссылке`);
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка: ${e}`);
        }
    };

    const removeAccess = async (itemId: string, permissionId: string) => {
        try {
            await invoke('remove_permission', { itemId, permissionId });
            onLogsUpdate(`✅ Удалён доступ по ссылке`);
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка: ${e}`);
        }
    };

    const exportLinksData = async () => {
        try {
            setExporting(true);
            onLogsUpdate('📊 Экспорт доступов по ссылкам...');
            const url = await invoke<string>('export_links_data', {
                auditResult: result,
            });
            onLogsUpdate(`✅ Таблица создана: ${url}`);
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка экспорта: ${e}`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <Box>
            <Card sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <Button
                        variant='contained'
                        color='primary'
                        startIcon={<Description />}
                        onClick={exportLinksData}
                        disabled={exporting || links.length === 0}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {exporting
                            ? 'Экспорт...'
                            : 'Экспорт доступов по ссылкам'}
                    </Button>
                    <Box sx={{ flex: 1 }} />
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{ alignSelf: 'center' }}
                    >
                        Найдено: {sorted.length} из {links.length}
                    </Typography>
                </Box>

                {/* Фильтры */}
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1.5fr',
                        gap: 2,
                        mb: 2,
                    }}
                >
                    <TextField
                        placeholder='Поиск по пути или названию...'
                        value={searchPath}
                        onChange={(e) => setSearchPath(e.target.value)}
                        size='small'
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position='start'>
                                    <Search />
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все доступы</MenuItem>
                        <MenuItem value='reader'>Просмотр</MenuItem>
                        <MenuItem value='commenter'>Комментатор</MenuItem>
                        <MenuItem value='writer'>Редактор</MenuItem>
                    </Select>
                    <Select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все типы</MenuItem>
                        <MenuItem value='folder'>Папки</MenuItem>
                        <MenuItem value='file'>Файлы</MenuItem>
                    </Select>
                    <Select
                        value={ownerFilter}
                        onChange={(e) => setOwnerFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все владельцы</MenuItem>
                        {uniqueOwners.map((owner) => (
                            <MenuItem
                                key={owner}
                                value={owner}
                            >
                                {owner}
                            </MenuItem>
                        ))}
                    </Select>
                </Box>

                {/* Сортировка */}
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {[
                        { field: 'name' as SortField, label: 'По имени' },
                        { field: 'path' as SortField, label: 'По пути' },
                        { field: 'type' as SortField, label: 'По типу' },
                        { field: 'role' as SortField, label: 'По роли' },
                        { field: 'owner' as SortField, label: 'По владельцу' },
                    ].map(({ field, label }) => (
                        <Chip
                            key={field}
                            label={label}
                            onClick={() => toggleSort(field)}
                            color={sortField === field ? 'primary' : 'default'}
                            variant={
                                sortField === field ? 'filled' : 'outlined'
                            }
                            icon={
                                sortField === field ? (
                                    <SwapVert
                                        sx={{
                                            transform:
                                                sortOrder === 'desc'
                                                    ? 'rotate(180deg)'
                                                    : 'none',
                                            transition: 'transform 0.2s',
                                        }}
                                    />
                                ) : undefined
                            }
                            sx={{ cursor: 'pointer' }}
                        />
                    ))}
                </Box>
            </Card>

            <Card sx={{ height: 600 }}>
                <AutoSizer>
                    {({ height, width }) => (
                        <VirtualList
                            height={height}
                            width={width}
                            rowCount={sorted.length}
                            rowHeight={100}
                            rowRenderer={({ index, key, style }) => {
                                const link = sorted[index];
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
                                                transition: 'all 0.2s',
                                                '&:hover': {
                                                    bgcolor: alpha(
                                                        '#1976d2',
                                                        0.05
                                                    ),
                                                    borderColor: 'primary.main',
                                                },
                                            }}
                                        >
                                            <Stack
                                                direction='row'
                                                justifyContent='space-between'
                                                alignItems='center'
                                                spacing={2}
                                            >
                                                <Box
                                                    sx={{
                                                        flex: 1,
                                                        minWidth: 0,
                                                    }}
                                                >
                                                    <Box
                                                        sx={{
                                                            display: 'flex',
                                                            gap: 1,
                                                            alignItems:
                                                                'center',
                                                            mb: 0.5,
                                                        }}
                                                    >
                                                        <Typography
                                                            variant='caption'
                                                            color='text.secondary'
                                                            sx={{
                                                                textTransform:
                                                                    'uppercase',
                                                            }}
                                                        >
                                                            {link.itemType ===
                                                            'file'
                                                                ? 'файл'
                                                                : 'папка'}
                                                        </Typography>
                                                        <Typography
                                                            variant='caption'
                                                            color='primary'
                                                        >
                                                            • {link.ownerEmail}
                                                        </Typography>
                                                    </Box>
                                                    <Typography
                                                        variant='body2'
                                                        sx={{
                                                            fontWeight: 600,
                                                            overflow: 'hidden',
                                                            textOverflow:
                                                                'ellipsis',
                                                            whiteSpace:
                                                                'nowrap',
                                                        }}
                                                    >
                                                        {link.itemName}
                                                    </Typography>
                                                    <Typography
                                                        variant='caption'
                                                        color='text.secondary'
                                                    >
                                                        {link.path}
                                                    </Typography>
                                                </Box>
                                                <Select
                                                    value={link.role}
                                                    size='small'
                                                    onChange={(e) =>
                                                        updateLinkRole(
                                                            link.itemId,
                                                            link.permissionId,
                                                            e.target.value
                                                        )
                                                    }
                                                    sx={{ minWidth: 140 }}
                                                >
                                                    <MenuItem value='reader'>
                                                        Просмотр
                                                    </MenuItem>
                                                    <MenuItem value='commenter'>
                                                        Комментатор
                                                    </MenuItem>
                                                    <MenuItem value='writer'>
                                                        Редактор
                                                    </MenuItem>
                                                </Select>
                                                <Tooltip title='Удалить доступ'>
                                                    <IconButton
                                                        size='small'
                                                        onClick={() =>
                                                            removeAccess(
                                                                link.itemId,
                                                                link.permissionId
                                                            )
                                                        }
                                                        sx={{
                                                            color: 'error.main',
                                                            '&:hover': {
                                                                bgcolor: alpha(
                                                                    '#f44336',
                                                                    0.1
                                                                ),
                                                            },
                                                        }}
                                                    >
                                                        <Delete fontSize='small' />
                                                    </IconButton>
                                                </Tooltip>
                                            </Stack>
                                        </Paper>
                                    </div>
                                );
                            }}
                        />
                    )}
                </AutoSizer>
            </Card>
        </Box>
    );
};

export default LinksView;
