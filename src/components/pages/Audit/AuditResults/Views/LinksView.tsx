import React, { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    alpha,
    Box,
    Button,
    Card,
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
import { Delete, Description, Search } from '@mui/icons-material';
import { AuditResult } from '../../types/interfaces.ts';
import { AutoSizer, List as VirtualList } from 'react-virtualized';

const LinksView: React.FC<{
    result: AuditResult;
    onLogsUpdate: (msg: string) => void;
}> = ({ result, onLogsUpdate }) => {
    const [searchPath, setSearchPath] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [exporting, setExporting] = useState(false);

    // Маппинг Rust enum → Google Drive API роли
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

    const links = useMemo(() => {
        const linkEntries = result.emailIndex['__link__'] || [];
        return linkEntries
            .map(([itemId, permIdx]) => {
                const item = result.items[itemId];
                if (!item) return null;
                const perm = item.permissions[permIdx];
                if (!perm || !perm.isLink) return null;

                return {
                    itemId,
                    itemName: item.name,
                    itemType: item.mimeType.includes('folder')
                        ? 'folder'
                        : 'file',
                    path: item.path,
                    role: roleToApi(perm.role), // конвертируем в API формат
                    permissionId: perm.permissionId,
                };
            })
            .filter(Boolean) as any[];
    }, [result]);

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
            return matchPath && matchRole && matchType;
        });
    }, [links, searchPath, roleFilter, typeFilter]);

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
                </Box>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr',
                        gap: 2,
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
                </Box>
            </Card>

            <Card sx={{ height: 600 }}>
                <AutoSizer>
                    {({ height, width }) => (
                        <VirtualList
                            height={height}
                            width={width}
                            rowCount={filtered.length}
                            rowHeight={100}
                            rowRenderer={({ index, key, style }) => {
                                const link = filtered[index];
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
