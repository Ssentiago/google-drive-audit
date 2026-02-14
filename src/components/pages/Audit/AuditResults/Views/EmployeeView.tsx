import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    alpha,
    Box,
    Button,
    Card,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
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
import LogDrawer from '../../../../common/LogDrawer.tsx';
import { AuditResult } from '../../types/interfaces.ts';
import { AutoSizer, List as VirtualList } from 'react-virtualized';
import {
    ArrowDownward,
    ArrowUpward,
    Description as DescriptionIcon,
    FilterList,
    Search as SearchIcon,
} from '@mui/icons-material';

type SortField = 'items' | 'name' | 'owners' | 'editors';
type SortOrder = 'asc' | 'desc';

const EmployeesView: React.FC<{
    result: AuditResult;
    onSelectEmployee: (email: string) => void;
    onLogsUpdate: (msg: string) => void;
    logs: string[];
    bulkMode: boolean;
    onBulkModeChange: (mode: boolean) => void;
    bulkEmailsInput: string;
    onBulkEmailsInputChange: (input: string) => void;
    scrollOffset: number;
    onScrollOffsetChange: (offset: number) => void;
}> = ({
    result,
    onSelectEmployee,
    onLogsUpdate,
    logs,
    bulkMode,
    onBulkModeChange,
    bulkEmailsInput,
    onBulkEmailsInputChange,
    scrollOffset,
    onScrollOffsetChange,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [minItemsFilter, setMinItemsFilter] = useState<string>('all');
    const [sortField, setSortField] = useState<SortField>('items');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
    const [exporting, setExporting] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);
    const [bulkDialogOpen, setBulkDialogOpen] = useState(false);

    const listRef = useRef<VirtualList>(null);

    useEffect(() => {
        if (listRef.current && scrollOffset > 0) {
            listRef.current.scrollToPosition(scrollOffset);
        }
    }, []);

    const parseBulkEmails = (input: string): Set<string> => {
        return new Set(
            input
                .split(/[\s,;]+/)
                .map((e) => e.trim().toLowerCase())
                .filter((e) => e.includes('@'))
        );
    };

    const bulkEmails = useMemo(
        () => parseBulkEmails(bulkEmailsInput),
        [bulkEmailsInput]
    );

    const employees = useMemo(() => {
        return Object.entries(result.emailIndex)
            .filter(([email]) => email !== '__link__')
            .map(([email, entries]) => {
                const stats = result.stats[email] || {
                    totalItems: 0,
                    owners: 0,
                    organizers: 0,
                    fileOrganizers: 0,
                    editors: 0,
                    commenters: 0,
                    viewers: 0,
                    linkAccesses: 0,
                };
                return { email, stats, totalItems: entries.length };
            });
    }, [result]);

    const filtered = useMemo(() => {
        let list = employees.filter((emp) => {
            if (bulkMode && bulkEmails.size > 0) {
                return bulkEmails.has(emp.email.toLowerCase());
            }

            const matchSearch =
                searchQuery === '' ||
                emp.email.toLowerCase().includes(searchQuery.toLowerCase());

            const matchRole =
                roleFilter === 'all' ||
                (roleFilter === 'owner' && emp.stats.owners > 0) ||
                (roleFilter === 'editor' && emp.stats.editors > 0) ||
                (roleFilter === 'viewer' && emp.stats.viewers > 0) ||
                (roleFilter === 'commenter' && emp.stats.commenters > 0);

            const matchMinItems =
                minItemsFilter === 'all' ||
                (minItemsFilter === '10' && emp.totalItems >= 10) ||
                (minItemsFilter === '50' && emp.totalItems >= 50) ||
                (minItemsFilter === '100' && emp.totalItems >= 100);

            return matchSearch && matchRole && matchMinItems;
        });

        list.sort((a, b) => {
            let aVal: any, bVal: any;

            switch (sortField) {
                case 'items':
                    aVal = a.totalItems;
                    bVal = b.totalItems;
                    break;
                case 'name':
                    aVal = a.email.toLowerCase();
                    bVal = b.email.toLowerCase();
                    break;
                case 'owners':
                    aVal = a.stats.owners;
                    bVal = b.stats.owners;
                    break;
                case 'editors':
                    aVal = a.stats.editors;
                    bVal = b.stats.editors;
                    break;
            }

            if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return list;
    }, [
        employees,
        searchQuery,
        roleFilter,
        minItemsFilter,
        sortField,
        sortOrder,
        bulkMode,
        bulkEmails,
    ]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder(field === 'name' ? 'asc' : 'desc');
        }
    };

    const stats = useMemo(() => {
        return {
            total: employees.length,
            filtered: filtered.length,
            totalItems: filtered.reduce((sum, e) => sum + e.totalItems, 0),
            withOwners: filtered.filter((e) => e.stats.owners > 0).length,
            withEditors: filtered.filter((e) => e.stats.editors > 0).length,
        };
    }, [employees, filtered]);

    const exportAllEmployees = async () => {
        try {
            setExporting(true);
            onLogsUpdate('📊 Экспорт всех сотрудников...');
            const url = await invoke<string>('export_all_employees', {
                auditResult: result,
            });
            onLogsUpdate(`✅ Таблица создана: ${url}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        } catch (e: any) {
            onLogsUpdate(`❌ Ошибка экспорта: ${e}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        } finally {
            setExporting(false);
        }
    };

    const exportEmployee = async (email: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            onLogsUpdate(`📊 Экспорт данных для ${email}...`);
            const url = await invoke<string>('export_employee_data', {
                email,
                auditResult: result,
            });
            onLogsUpdate(`✅ Таблица создана: ${url}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        } catch (err: any) {
            onLogsUpdate(`❌ Ошибка экспорта: ${err}`);
            if (!drawerOpen) setNewLogsCount((c) => c + 1);
        }
    };

    return (
        <Box>
            <Card sx={{ p: 2, mb: 2 }}>
                <Box
                    sx={{
                        display: 'flex',
                        gap: 2,
                        mb: 2,
                        alignItems: 'center',
                    }}
                >
                    <Button
                        variant='contained'
                        color='primary'
                        startIcon={<DescriptionIcon />}
                        onClick={exportAllEmployees}
                        disabled={exporting}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {exporting ? 'Экспорт...' : 'Экспорт всех'}
                    </Button>

                    <Button
                        variant={bulkMode ? 'contained' : 'outlined'}
                        color={bulkMode ? 'warning' : 'primary'}
                        onClick={() => setBulkDialogOpen(true)}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {bulkMode
                            ? `👥 Список (${bulkEmails.size})`
                            : '👥 По списку'}
                    </Button>

                    {bulkMode && (
                        <Button
                            variant='outlined'
                            color='warning'
                            size='small'
                            onClick={() => {
                                onBulkModeChange(false);
                                onBulkEmailsInputChange('');
                            }}
                            sx={{ textTransform: 'none' }}
                        >
                            Сбросить
                        </Button>
                    )}

                    <Box sx={{ flex: 1 }} />

                    <Stack
                        direction='row'
                        spacing={1}
                    >
                        <Chip
                            size='small'
                            label={`Всего: ${stats.total}`}
                        />
                        <Chip
                            size='small'
                            label={`Показано: ${stats.filtered}`}
                            color='primary'
                        />
                        <Chip
                            size='small'
                            label={`Доступов: ${stats.totalItems}`}
                            variant='outlined'
                        />
                    </Stack>

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

                {!bulkMode && (
                    <>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: '2fr 1fr 1fr',
                                gap: 2,
                                mb: 2,
                            }}
                        >
                            <TextField
                                placeholder='Поиск по email...'
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                size='small'
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position='start'>
                                            <SearchIcon />
                                        </InputAdornment>
                                    ),
                                }}
                            />
                            <Select
                                value={roleFilter}
                                onChange={(e) => setRoleFilter(e.target.value)}
                                size='small'
                            >
                                <MenuItem value='all'>Все роли</MenuItem>
                                <MenuItem value='owner'>👑 Владельцы</MenuItem>
                                <MenuItem value='editor'>✏️ Редакторы</MenuItem>
                                <MenuItem value='commenter'>
                                    💬 Комментаторы
                                </MenuItem>
                                <MenuItem value='viewer'>👁️ Просмотр</MenuItem>
                            </Select>
                            <Select
                                value={minItemsFilter}
                                onChange={(e) =>
                                    setMinItemsFilter(e.target.value)
                                }
                                size='small'
                            >
                                <MenuItem value='all'>
                                    Любое количество
                                </MenuItem>
                                <MenuItem value='10'>≥ 10 доступов</MenuItem>
                                <MenuItem value='50'>≥ 50 доступов</MenuItem>
                                <MenuItem value='100'>≥ 100 доступов</MenuItem>
                            </Select>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {[
                                {
                                    field: 'items' as SortField,
                                    label: 'Доступов',
                                },
                                {
                                    field: 'owners' as SortField,
                                    label: 'Владельцев',
                                },
                                {
                                    field: 'editors' as SortField,
                                    label: 'Редакторов',
                                },
                                { field: 'name' as SortField, label: 'Email' },
                            ].map(({ field, label }) => (
                                <Chip
                                    key={field}
                                    label={label}
                                    onClick={() => toggleSort(field)}
                                    color={
                                        sortField === field
                                            ? 'primary'
                                            : 'default'
                                    }
                                    variant={
                                        sortField === field
                                            ? 'filled'
                                            : 'outlined'
                                    }
                                    icon={
                                        sortField === field ? (
                                            sortOrder === 'asc' ? (
                                                <ArrowUpward />
                                            ) : (
                                                <ArrowDownward />
                                            )
                                        ) : undefined
                                    }
                                    sx={{ cursor: 'pointer' }}
                                />
                            ))}
                        </Box>
                    </>
                )}

                {bulkMode && (
                    <Box
                        sx={{
                            display: 'flex',
                            gap: 1,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                        }}
                    >
                        <Chip
                            label={`В списке: ${bulkEmails.size}`}
                            size='small'
                            color='primary'
                        />
                        <Chip
                            label={`✅ Найдено: ${filtered.length}`}
                            size='small'
                            color='success'
                        />
                        {bulkEmails.size - filtered.length > 0 && (
                            <Chip
                                label={`⚠️ Не найдено: ${bulkEmails.size - filtered.length}`}
                                size='small'
                                color='warning'
                            />
                        )}
                    </Box>
                )}
            </Card>

            <Card sx={{ height: 600 }}>
                <AutoSizer>
                    {({ height, width }) => (
                        <VirtualList
                            ref={listRef}
                            height={height}
                            width={width}
                            rowCount={filtered.length}
                            rowHeight={90}
                            onScroll={({ scrollTop }) => {
                                onScrollOffsetChange(scrollTop);
                            }}
                            rowRenderer={({ index, key, style }) => {
                                const emp = filtered[index];
                                return (
                                    <div
                                        key={key}
                                        style={style}
                                    >
                                        <Paper
                                            variant='outlined'
                                            sx={{
                                                m: 1,
                                                p: 2,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                bgcolor: bulkMode
                                                    ? alpha('#ff9800', 0.05)
                                                    : 'transparent',
                                                borderColor: bulkMode
                                                    ? 'warning.main'
                                                    : 'divider',
                                                '&:hover': {
                                                    bgcolor: alpha(
                                                        '#1976d2',
                                                        0.05
                                                    ),
                                                    borderColor: 'primary.main',
                                                },
                                            }}
                                            onClick={() =>
                                                onSelectEmployee(emp.email)
                                            }
                                        >
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 2,
                                                }}
                                            >
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
                                                            fontFamily:
                                                                'monospace',
                                                        }}
                                                    >
                                                        {emp.email}
                                                    </Typography>
                                                    <Box
                                                        sx={{
                                                            display: 'flex',
                                                            gap: 0.5,
                                                            mt: 1,
                                                            flexWrap: 'wrap',
                                                        }}
                                                    >
                                                        {emp.stats.owners >
                                                            0 && (
                                                            <Chip
                                                                label={`👑 ${emp.stats.owners}`}
                                                                size='small'
                                                                variant='outlined'
                                                                color='error'
                                                            />
                                                        )}
                                                        {emp.stats.editors >
                                                            0 && (
                                                            <Chip
                                                                label={`✏️ ${emp.stats.editors}`}
                                                                size='small'
                                                                variant='outlined'
                                                                color='warning'
                                                            />
                                                        )}
                                                        {emp.stats.commenters >
                                                            0 && (
                                                            <Chip
                                                                label={`💬 ${emp.stats.commenters}`}
                                                                size='small'
                                                                variant='outlined'
                                                            />
                                                        )}
                                                        {emp.stats.viewers >
                                                            0 && (
                                                            <Chip
                                                                label={`👁️ ${emp.stats.viewers}`}
                                                                size='small'
                                                                variant='outlined'
                                                                color='info'
                                                            />
                                                        )}
                                                    </Box>
                                                </Box>
                                                <Chip
                                                    label={emp.totalItems}
                                                    color='primary'
                                                    sx={{
                                                        fontWeight: 700,
                                                        fontSize: 16,
                                                    }}
                                                />
                                                <Tooltip title='Экспорт данных'>
                                                    <IconButton
                                                        size='small'
                                                        onClick={(e) =>
                                                            exportEmployee(
                                                                emp.email,
                                                                e
                                                            )
                                                        }
                                                        sx={{
                                                            color: 'primary.main',
                                                        }}
                                                    >
                                                        <DescriptionIcon />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        </Paper>
                                    </div>
                                );
                            }}
                        />
                    )}
                </AutoSizer>
            </Card>

            <Dialog
                open={bulkDialogOpen}
                onClose={() => setBulkDialogOpen(false)}
                maxWidth='sm'
                fullWidth
            >
                <DialogTitle sx={{ fontWeight: 700 }}>
                    Поиск по списку email
                </DialogTitle>
                <DialogContent>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{ mb: 2 }}
                    >
                        Вставьте email через пробел, запятую, точку с запятой
                        или перенос строки
                    </Typography>
                    <TextField
                        multiline
                        rows={10}
                        fullWidth
                        placeholder={'user1@gmail.com\nuser2@gmail.com\n...'}
                        value={bulkEmailsInput}
                        onChange={(e) =>
                            onBulkEmailsInputChange(e.target.value)
                        }
                        sx={{
                            '& textarea': {
                                fontFamily: 'monospace',
                                fontSize: 13,
                            },
                        }}
                    />
                    {bulkEmailsInput && (
                        <Box
                            sx={{
                                mt: 1.5,
                                display: 'flex',
                                gap: 1,
                                flexWrap: 'wrap',
                            }}
                        >
                            <Chip
                                label={`Распознано: ${bulkEmails.size}`}
                                size='small'
                                color='primary'
                            />
                            {(() => {
                                const found = [...bulkEmails].filter(
                                    (e) => result.emailIndex[e]
                                ).length;
                                const notFound = bulkEmails.size - found;
                                return (
                                    <>
                                        <Chip
                                            label={`✅ Найдено: ${found}`}
                                            size='small'
                                            color='success'
                                        />
                                        {notFound > 0 && (
                                            <Chip
                                                label={`⚠️ Не найдено: ${notFound}`}
                                                size='small'
                                                color='warning'
                                            />
                                        )}
                                    </>
                                );
                            })()}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBulkDialogOpen(false)}>
                        Отмена
                    </Button>
                    <Button
                        variant='contained'
                        disabled={bulkEmails.size === 0}
                        onClick={() => {
                            onBulkModeChange(true);
                            setBulkDialogOpen(false);
                        }}
                    >
                        Применить ({bulkEmails.size})
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default EmployeesView;
