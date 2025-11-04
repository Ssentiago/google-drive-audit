import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    Box,
    Button,
    TextField,
    Typography,
    Paper,
    Stack,
    Chip,
    Tabs,
    Tab,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    IconButton,
    Select,
    MenuItem,
    Pagination,
    Alert,
    CircularProgress,
    Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import { List, AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css';

interface AccessDetail {
    itemId: string;
    itemName: string;
    itemType: string;
    url: string;
    role: string;
    permissionId: string | null;
    path: string;
}
interface EmployeeAccess {
    email: string;
    displayName: string;
    totalAccess: number;
    roles: Record<string, number>;
    accesses: AccessDetail[];
}
interface LinkAccess {
    itemId: string;
    itemName: string;
    itemType: string;
    url: string;
    linkShareRole: string;
    permissionId: string;
    path: string;
}
interface AuditResult {
    employees: EmployeeAccess[];
    linkAccesses: LinkAccess[];
    scanDate: string;
}
interface UndoAction {
    itemId: string;
    permissionId: string;
    employeeEmail?: string;
    timeout: NodeJ;
}

const PAGE_SIZE = 50;

export const AuditMode: React.FC = () => {
    const [folderId, setFolderId] = useState('');
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState<AuditResult | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<'employees' | 'links'>(
        'employees'
    );

    // раскрытие сотрудников + пагинация
    const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(
        new Set()
    );
    const [employeePages, setEmployeePages] = useState<Map<string, number>>(
        new Map()
    );

    // undo
    const [undoActions, setUndoActions] = useState<Map<string, UndoAction>>(
        new Map()
    );

    useEffect(() => {
        const unlisten = listen('audit_log', (event) => {
            setLogs((p) => [...p, event.payload as string]);
        });
        return () => {
            unlisten.then((fn) => fn());
        };
    }, []);

    const handleScan = async () => {
        if (!folderId.trim()) return alert('Укажи ID папки');
        setScanning(true);
        setLogs([]);
        setResult(null);
        try {
            const data = await invoke<AuditResult>('audit_drive', {
                folderId: folderId.trim(),
            });
            setResult(data);
        } catch (e: any) {
            alert(`Ошибка: ${e}`);
        } finally {
            setScanning(false);
        }
    };

    const toggleEmployee = (email: string) => {
        setExpandedEmployees((prev) => {
            const n = new Set(prev);
            n.has(email) ? n.delete(email) : n.add(email);
            return n;
        });
    };

    const getPage = (email: string) => employeePages.get(email) ?? 0;
    const setPage = (email: string, page: number) => {
        setEmployeePages((prev) => new Map(prev).set(email, page));
    };

    const removeAccess = async (
        itemId: string,
        permissionId: string,
        employeeEmail?: string
    ) => {
        try {
            await invoke('remove_access', { itemId, permissionId });

            const key = `${itemId}-${permissionId}`;
            const timeout = setTimeout(() => {
                setUndoActions((p) => {
                    const n = new Map(p);
                    n.delete(key);
                    return n;
                });
            }, 20_000);

            setUndoActions((p) =>
                new Map(p).set(key, {
                    itemId,
                    permissionId,
                    employeeEmail,
                    timeout,
                })
            );

            setResult((prev) => {
                if (!prev) return prev;
                if (employeeEmail) {
                    return {
                        ...prev,
                        employees: prev.employees.map((emp) =>
                            emp.email === employeeEmail
                                ? {
                                      ...emp,
                                      accesses: emp.accesses.filter(
                                          (a) =>
                                              !(
                                                  a.itemId === itemId &&
                                                  a.permissionId ===
                                                      permissionId
                                              )
                                      ),
                                      totalAccess: emp.totalAccess - 1,
                                  }
                                : emp
                        ),
                    };
                }
                return {
                    ...prev,
                    linkAccesses: prev.linkAccesses.filter(
                        (l) =>
                            !(
                                l.itemId === itemId &&
                                l.permissionId === permissionId
                            )
                    ),
                };
            });
        } catch (e: any) {
            alert(`Ошибка удаления: ${e}`);
        }
    };

    const undoRemove = (key: string) => {
        const action = undoActions.get(key);
        if (!action) return;
        clearTimeout(action.timeout);
        setUndoActions((p) => {
            const n = new Map(p);
            n.delete(key);
            return n;
        });
        alert(
            'Отмена удаления — перезапусти сканирование, чтобы увидеть актуальные данные'
        );
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
            setResult((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    linkAccesses: prev.linkAccesses.map((l) =>
                        l.itemId === itemId && l.permissionId === permissionId
                            ? { ...l, linkShareRole: newRole }
                            : l
                    ),
                };
            });
        } catch (e: any) {
            alert(`Ошибка: ${e}`);
        }
    };

    const exportEmployee = async (emp: EmployeeAccess) => {
        try {
            await invoke('export_employee_data', { employee: emp });
        } catch (e: any) {
            alert(`Экспорт: ${e}`);
        }
    };
    const exportAll = async () => {
        if (!result) return;
        try {
            await invoke('export_all_employees', { auditResult: result });
        } catch (e: any) {
            alert(`Экспорт всех: ${e}`);
        }
    };

    const roleToRu = (r: string) =>
        ({
            owner: 'Владелец',
            writer: 'Редактор',
            commenter: 'Комментатор',
            reader: 'Просмотр',
        })[r] ?? r;

    return (
        <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
            <Typography
                variant='h5'
                gutterBottom
            >
                Режим аудита доступов
            </Typography>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack
                    direction='row'
                    spacing={2}
                    alignItems='center'
                >
                    <TextField
                        label='ID папки'
                        value={folderId}
                        onChange={(e) => setFolderId(e.target.value)}
                        disabled={scanning}
                        size='small'
                        sx={{ width: 360 }}
                    />
                    <Button
                        variant='contained'
                        onClick={handleScan}
                        disabled={scanning || !folderId.trim()}
                        startIcon={
                            scanning ? <CircularProgress size={20} /> : null
                        }
                    >
                        {scanning ? 'Сканирую…' : 'Запустить аудит'}
                    </Button>
                    {result && (
                        <Button
                            variant='outlined'
                            startIcon={<DescriptionIcon />}
                            onClick={exportAll}
                        >
                            Экспорт всех
                        </Button>
                    )}
                </Stack>
            </Paper>

            {logs.length > 0 && (
                <Paper
                    variant='outlined'
                    sx={{
                        mb: 3,
                        maxHeight: 320,
                        overflow: 'hidden',
                        backgroundColor: 'grey.50',
                        borderRadius: 2,
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            borderBottom: 1,
                            borderColor: 'divider',
                            backgroundColor: 'background.paper',
                        }}
                    >
                        <Typography
                            variant='subtitle2'
                            fontWeight={600}
                        >
                            Лог аудита ({logs.length})
                        </Typography>
                        <Button
                            size='small'
                            onClick={() => setLogs([])}
                            color='error'
                        >
                            Очистить
                        </Button>
                    </Box>

                    <Box
                        ref={(el) => {
                            if (el) {
                                el.scrollTop = el.scrollHeight;
                            }
                        }}
                        sx={{
                            p: 2,
                            maxHeight: 260,
                            overflowY: 'auto',
                            fontFamily: 'Monospace',
                            fontSize: '0.875rem',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                        }}
                    >
                        {logs.map((line, i) => (
                            <div key={i}>{line}</div>
                        ))}
                    </Box>
                </Paper>
            )}

            {result && (
                <>
                    <Tabs
                        value={activeTab}
                        onChange={(_, v) => setActiveTab(v)}
                        sx={{ mb: 3 }}
                    >
                        <Tab
                            label={`Сотрудники (${result.employees.length})`}
                            value='employees'
                        />
                        <Tab
                            label={`Ссылки (${result.linkAccesses.length})`}
                            value='links'
                        />
                    </Tabs>
                    {/* ==== СОТРУДНИКИ ==== */}
                    {activeTab === 'employees' && (
                        <Stack spacing={2}>
                            {result.employees.map((emp) => {
                                const expanded = expandedEmployees.has(
                                    emp.email
                                );
                                const page = getPage(emp.email);
                                const totalPages = Math.ceil(
                                    emp.accesses.length / PAGE_SIZE
                                );
                                const slice = expanded
                                    ? emp.accesses.slice(
                                          page * PAGE_SIZE,
                                          (page + 1) * PAGE_SIZE
                                      )
                                    : [];

                                return (
                                    <Accordion
                                        key={emp.email}
                                        expanded={expanded}
                                        onChange={() =>
                                            toggleEmployee(emp.email)
                                        }
                                    >
                                        <AccordionSummary
                                            expandIcon={<ExpandMoreIcon />}
                                        >
                                            <Stack
                                                direction='row'
                                                alignItems='center'
                                                spacing={2}
                                                sx={{ width: '100%' }}
                                            >
                                                <Box>
                                                    <Typography
                                                        fontWeight={600}
                                                    >
                                                        {emp.displayName}
                                                    </Typography>
                                                    <Typography
                                                        variant='body2'
                                                        color='text.secondary'
                                                    >
                                                        {emp.email}
                                                    </Typography>
                                                </Box>
                                                <Chip
                                                    label={emp.totalAccess}
                                                    color='primary'
                                                    size='small'
                                                />
                                                {Object.entries(emp.roles).map(
                                                    ([r, c]) => (
                                                        <Chip
                                                            key={r}
                                                            label={`${roleToRu(r)}: ${c}`}
                                                            size='small'
                                                            variant='outlined'
                                                        />
                                                    )
                                                )}
                                                <Button
                                                    size='small'
                                                    startIcon={
                                                        <DescriptionIcon />
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        exportEmployee(emp);
                                                    }}
                                                >
                                                    Экспорт
                                                </Button>
                                            </Stack>
                                        </AccordionSummary>

                                        <AccordionDetails>
                                            <Stack spacing={1}>
                                                {slice.map((acc) => {
                                                    const undoKey = `${acc.itemId}-${acc.permissionId}`;
                                                    const canUndo =
                                                        undoActions.has(
                                                            undoKey
                                                        );
                                                    return (
                                                        <Paper
                                                            key={undoKey}
                                                            variant='outlined'
                                                            sx={{ p: 2 }}
                                                        >
                                                            <Stack
                                                                direction='row'
                                                                justifyContent='space-between'
                                                                alignItems='center'
                                                            >
                                                                <Box>
                                                                    <Typography
                                                                        variant='caption'
                                                                        color='text.secondary'
                                                                    >
                                                                        {
                                                                            acc.itemType
                                                                        }
                                                                    </Typography>
                                                                    <Typography>
                                                                        <a
                                                                            href={
                                                                                acc.url
                                                                            }
                                                                            target='_blank'
                                                                            rel='noopener noreferrer'
                                                                        >
                                                                            {
                                                                                acc.itemName
                                                                            }
                                                                        </a>
                                                                    </Typography>
                                                                    <Typography variant='body2'>
                                                                        {roleToRu(
                                                                            acc.role
                                                                        )}{' '}
                                                                        •{' '}
                                                                        {
                                                                            acc.path
                                                                        }
                                                                    </Typography>
                                                                </Box>

                                                                {canUndo ? (
                                                                    <Tooltip title='Отменить удаление (20 сек)'>
                                                                        <IconButton
                                                                            onClick={() =>
                                                                                undoRemove(
                                                                                    undoKey
                                                                                )
                                                                            }
                                                                        >
                                                                            <UndoIcon />
                                                                        </IconButton>
                                                                    </Tooltip>
                                                                ) : (
                                                                    <Tooltip title='Удалить доступ'>
                                                                        <IconButton
                                                                            color='error'
                                                                            onClick={() =>
                                                                                removeAccess(
                                                                                    acc.itemId,
                                                                                    acc.permissionId!,
                                                                                    emp.email
                                                                                )
                                                                            }
                                                                        >
                                                                            <DeleteIcon />
                                                                        </IconButton>
                                                                    </Tooltip>
                                                                )}
                                                            </Stack>
                                                        </Paper>
                                                    );
                                                })}

                                                {totalPages > 1 && (
                                                    <Pagination
                                                        count={totalPages}
                                                        page={page + 1}
                                                        onChange={(_, p) =>
                                                            setPage(
                                                                emp.email,
                                                                p - 1
                                                            )
                                                        }
                                                        size='small'
                                                        sx={{
                                                            alignSelf: 'center',
                                                            mt: 2,
                                                        }}
                                                    />
                                                )}
                                            </Stack>
                                        </AccordionDetails>
                                    </Accordion>
                                );
                            })}
                        </Stack>
                    )}
                    {/* ==== ССЫЛКИ ==== */}
                    {activeTab === 'links' &&
                        (result.linkAccesses.length === 0 ? (
                            <Typography
                                color='text.secondary'
                                align='center'
                            >
                                Нет доступов по ссылке
                            </Typography>
                        ) : (
                            <Box sx={{ height: 680, width: '100%' }}>
                                <AutoSizer>
                                    {({ height, width }) => (
                                        <List
                                            height={height}
                                            width={width}
                                            rowCount={
                                                result.linkAccesses.length
                                            }
                                            rowHeight={92}
                                            rowRenderer={({
                                                index,
                                                key,
                                                style,
                                            }) => {
                                                const link =
                                                    result.linkAccesses[index];
                                                const undoKey = `${link.itemId}-${link.permissionId}`;
                                                const canUndo =
                                                    undoActions.has(undoKey);

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
                                                                height: '100%',
                                                                boxSizing:
                                                                    'border-box',
                                                            }}
                                                        >
                                                            <Stack
                                                                direction='row'
                                                                justifyContent='space-between'
                                                                alignItems='center'
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
                                                                    >
                                                                        {
                                                                            link.itemType
                                                                        }
                                                                    </Typography>
                                                                    <Typography
                                                                        noWrap
                                                                    >
                                                                        <a
                                                                            href={
                                                                                link.url
                                                                            }
                                                                            target='_blank'
                                                                            rel='noopener noreferrer'
                                                                            style={{
                                                                                color: 'inherit',
                                                                                textDecoration:
                                                                                    'none',
                                                                            }}
                                                                            onClick={(
                                                                                e
                                                                            ) => {
                                                                                invoke(
                                                                                    'open_url',
                                                                                    {
                                                                                        url: link.url,
                                                                                    }
                                                                                );
                                                                                e.stopPropagation();
                                                                            }}
                                                                        >
                                                                            {
                                                                                link.itemName
                                                                            }
                                                                        </a>
                                                                    </Typography>
                                                                    <Typography
                                                                        variant='body2'
                                                                        color='text.secondary'
                                                                        noWrap
                                                                    >
                                                                        {
                                                                            link.path
                                                                        }
                                                                    </Typography>
                                                                </Box>

                                                                <Stack
                                                                    direction='row'
                                                                    spacing={1}
                                                                    alignItems='center'
                                                                >
                                                                    <Select
                                                                        value={
                                                                            link.linkShareRole
                                                                        }
                                                                        size='small'
                                                                        onChange={(
                                                                            e
                                                                        ) =>
                                                                            updateLinkRole(
                                                                                link.itemId,
                                                                                link.permissionId,
                                                                                e
                                                                                    .target
                                                                                    .value
                                                                            )
                                                                        }
                                                                        sx={{
                                                                            minWidth: 120,
                                                                        }}
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

                                                                    {canUndo ? (
                                                                        <Tooltip title='Отменить (20 сек)'>
                                                                            <IconButton
                                                                                onClick={() =>
                                                                                    undoRemove(
                                                                                        undoKey
                                                                                    )
                                                                                }
                                                                                color='primary'
                                                                            >
                                                                                <UndoIcon />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    ) : (
                                                                        <Tooltip title='Удалить ссылку'>
                                                                            <IconButton
                                                                                color='error'
                                                                                onClick={() =>
                                                                                    removeAccess(
                                                                                        link.itemId,
                                                                                        link.permissionId
                                                                                    )
                                                                                }
                                                                            >
                                                                                <DeleteIcon />
                                                                            </IconButton>
                                                                        </Tooltip>
                                                                    )}
                                                                </Stack>
                                                            </Stack>
                                                        </Paper>
                                                    </div>
                                                );
                                            }}
                                        />
                                    )}
                                </AutoSizer>
                            </Box>
                        ))}
                </>
            )}
        </Box>
    );
};

export default AuditMode;
