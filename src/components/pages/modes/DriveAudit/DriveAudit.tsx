import React, { useState, useEffect, useMemo, useRef } from 'react';
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
    IconButton,
    Select,
    MenuItem,
    Badge,
    Drawer,
    Card,
    Divider,
    Tooltip,
    InputAdornment,
    Container,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    LinearProgress,
    alpha,
    Tabs,
    Tab,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import SearchIcon from '@mui/icons-material/Search';
import TerminalIcon from '@mui/icons-material/Terminal';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import PeopleIcon from '@mui/icons-material/People';
import LinkIcon from '@mui/icons-material/Link';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { List as VirtualList, AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css';
import AuditTree from './AuditTree.tsx';
import { useGlobalContext } from '../../../../core/GlobalContext.tsx';
import LogDrawer from '../../../common/LogDrawer.tsx';
import { FolderSelector } from '../../../common/FolderSelector.tsx';

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

interface ScanProgress {
    foldersProcessed: number;
    filesProcessed: number;
}

interface AuditResult {
    employees: EmployeeAccess[];
    linkAccesses: LinkAccess[];
    scanDate: string;
}

interface SavedFolder {
    id: string;
    name: string;
    savedAt: number;
    lastScan?: {
        timestamp: number;
        foldersCount: number;
        filesCount: number;
        durationSec: number;
        suspiciousCount: number;
    };
    scanHistory: any[];
}
const EmployeesView: React.FC<any> = ({
    result,
    searchQuery,
    setSearchQuery,
    roleFilter,
    setRoleFilter,
    sortBy,
    setSortBy,
    selectedEmployee,
    setSelectedEmployee,
    exportEmployee,
    roleToRu,
    filteredEmployees,
    selectedEmpData,
}) => {
    return (
        <Box>
            {/* Filters */}
            <Card sx={{ p: 2, mb: 2 }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr',
                        gap: 2,
                    }}
                >
                    <TextField
                        placeholder='Поиск по email или имени...'
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
                        <MenuItem value='owner'>Владелец</MenuItem>
                        <MenuItem value='writer'>Редактор</MenuItem>
                        <MenuItem value='commenter'>Комментатор</MenuItem>
                        <MenuItem value='reader'>Просмотр</MenuItem>
                    </Select>
                    <Select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        size='small'
                    >
                        <MenuItem value='accesses'>По количеству</MenuItem>
                        <MenuItem value='name'>По имени</MenuItem>
                    </Select>
                </Box>
            </Card>

            {/* Content */}
            <Box
                sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 480px)' }}
            >
                {/* Employees List */}
                <Card
                    sx={{
                        flex: '0 0 60%',
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                        <Typography
                            variant='h6'
                            sx={{ fontWeight: 600 }}
                        >
                            Сотрудники ({filteredEmployees.length})
                        </Typography>
                    </Box>
                    <Box sx={{ flex: 1 }}>
                        <AutoSizer>
                            {({ height, width }) => (
                                <VirtualList
                                    height={height}
                                    width={width}
                                    rowCount={filteredEmployees.length}
                                    rowHeight={80}
                                    rowRenderer={({ index, key, style }) => {
                                        const emp = filteredEmployees[index];
                                        const isSelected =
                                            selectedEmployee === emp.email;
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
                                                        bgcolor: isSelected
                                                            ? alpha(
                                                                  '#1976d2',
                                                                  0.1
                                                              )
                                                            : 'background.paper',
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
                                                        setSelectedEmployee(
                                                            emp.email
                                                        )
                                                    }
                                                >
                                                    <Stack
                                                        direction='row'
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
                                                                {
                                                                    emp.displayName
                                                                }
                                                            </Typography>
                                                            <Typography
                                                                variant='body2'
                                                                color='text.secondary'
                                                                sx={{
                                                                    overflow:
                                                                        'hidden',
                                                                    textOverflow:
                                                                        'ellipsis',
                                                                    whiteSpace:
                                                                        'nowrap',
                                                                    fontFamily:
                                                                        'monospace',
                                                                    fontSize: 12,
                                                                }}
                                                            >
                                                                {emp.email}
                                                            </Typography>
                                                        </Box>
                                                        <Chip
                                                            label={
                                                                emp.totalAccess
                                                            }
                                                            color='primary'
                                                            size='small'
                                                            sx={{
                                                                fontWeight: 600,
                                                            }}
                                                        />
                                                        <Stack
                                                            direction='row'
                                                            spacing={0.5}
                                                        >
                                                            {Object.entries(
                                                                emp.roles
                                                            ).map(([r, c]) => (
                                                                <Chip
                                                                    key={r}
                                                                    label={`${roleToRu(r)}: ${c}`}
                                                                    size='small'
                                                                    variant='outlined'
                                                                />
                                                            ))}
                                                        </Stack>
                                                        <Tooltip title='Экспорт'>
                                                            <IconButton
                                                                size='small'
                                                                onClick={(
                                                                    e
                                                                ) => {
                                                                    e.stopPropagation();
                                                                    exportEmployee(
                                                                        emp
                                                                    );
                                                                }}
                                                            >
                                                                <DescriptionIcon fontSize='small' />
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
                    </Box>
                </Card>

                {/* Details Panel */}
                <Card
                    sx={{
                        flex: '0 0 40%',
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    {selectedEmpData ? (
                        <>
                            <Box
                                sx={{
                                    p: 2,
                                    borderBottom: 1,
                                    borderColor: 'divider',
                                }}
                            >
                                <Typography
                                    variant='h6'
                                    sx={{ fontWeight: 600 }}
                                >
                                    {selectedEmpData.displayName}
                                </Typography>
                                <Typography
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{
                                        fontFamily: 'monospace',
                                        fontSize: 12,
                                        mt: 0.5,
                                    }}
                                >
                                    {selectedEmpData.email}
                                </Typography>
                                <Chip
                                    label={`${selectedEmpData.totalAccess} доступов`}
                                    size='small'
                                    color='primary'
                                    sx={{ mt: 1, fontWeight: 600 }}
                                />
                            </Box>
                            <Box sx={{ flex: 1, overflow: 'auto' }}>
                                <AutoSizer>
                                    {({ height, width }) => (
                                        <VirtualList
                                            height={height}
                                            width={width}
                                            rowCount={
                                                selectedEmpData.accesses.length
                                            }
                                            rowHeight={100}
                                            rowRenderer={({
                                                index,
                                                key,
                                                style,
                                            }) => {
                                                const acc =
                                                    selectedEmpData.accesses[
                                                        index
                                                    ];
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
                                                                transition:
                                                                    'all 0.2s',
                                                                '&:hover': {
                                                                    bgcolor:
                                                                        alpha(
                                                                            '#1976d2',
                                                                            0.05
                                                                        ),
                                                                    borderColor:
                                                                        'primary.main',
                                                                },
                                                            }}
                                                        >
                                                            <Stack
                                                                spacing={0.5}
                                                            >
                                                                <Typography
                                                                    variant='caption'
                                                                    color='text.secondary'
                                                                    sx={{
                                                                        textTransform:
                                                                            'uppercase',
                                                                    }}
                                                                >
                                                                    {
                                                                        acc.itemType
                                                                    }
                                                                </Typography>
                                                                <Typography
                                                                    variant='body2'
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
                                                                    <a
                                                                        href={
                                                                            acc.url
                                                                        }
                                                                        target='_blank'
                                                                        rel='noopener noreferrer'
                                                                        style={{
                                                                            color: 'inherit',
                                                                            textDecoration:
                                                                                'none',
                                                                        }}
                                                                    >
                                                                        {
                                                                            acc.itemName
                                                                        }
                                                                    </a>
                                                                </Typography>
                                                                <Typography
                                                                    variant='caption'
                                                                    color='text.secondary'
                                                                >
                                                                    {roleToRu(
                                                                        acc.role
                                                                    )}{' '}
                                                                    • {acc.path}
                                                                </Typography>
                                                            </Stack>
                                                        </Paper>
                                                    </div>
                                                );
                                            }}
                                        />
                                    )}
                                </AutoSizer>
                            </Box>
                        </>
                    ) : (
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                p: 4,
                                textAlign: 'center',
                            }}
                        >
                            <Typography color='text.secondary'>
                                Выберите сотрудника для просмотра доступов
                            </Typography>
                        </Box>
                    )}
                </Card>
            </Box>
        </Box>
    );
};

const LinksView: React.FC<any> = ({
    filteredLinks,
    linkPathSearch,
    setLinkPathSearch,
    linkRoleFilter,
    setLinkRoleFilter,
    linkTypeFilter,
    setLinkTypeFilter,
    updateLinkRole,
    removeAccess,
}) => {
    return (
        <Box>
            {/* Filters */}
            <Card sx={{ p: 2, mb: 2 }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr',
                        gap: 2,
                    }}
                >
                    <TextField
                        placeholder='Поиск по пути или названию...'
                        value={linkPathSearch}
                        onChange={(e) => setLinkPathSearch(e.target.value)}
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
                        value={linkRoleFilter}
                        onChange={(e) => setLinkRoleFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все доступы</MenuItem>
                        <MenuItem value='reader'>Просмотр</MenuItem>
                        <MenuItem value='commenter'>Комментатор</MenuItem>
                        <MenuItem value='writer'>Редактор</MenuItem>
                    </Select>
                    <Select
                        value={linkTypeFilter}
                        onChange={(e) => setLinkTypeFilter(e.target.value)}
                        size='small'
                    >
                        <MenuItem value='all'>Все типы</MenuItem>
                        <MenuItem value='folder'>Папки</MenuItem>
                        <MenuItem value='file'>Файлы</MenuItem>
                    </Select>
                </Box>
            </Card>

            {/* Links List */}
            <Card sx={{ height: 'calc(100vh - 480px)' }}>
                <AutoSizer>
                    {({ height, width }) => (
                        <VirtualList
                            height={height}
                            width={width}
                            rowCount={filteredLinks.length}
                            rowHeight={100}
                            rowRenderer={({ index, key, style }) => {
                                const link = filteredLinks[index];
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
                                                        {link.itemType}
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
                                                        <a
                                                            href={link.url}
                                                            target='_blank'
                                                            rel='noopener noreferrer'
                                                            style={{
                                                                color: 'inherit',
                                                                textDecoration:
                                                                    'none',
                                                            }}
                                                        >
                                                            {link.itemName}
                                                        </a>
                                                    </Typography>
                                                    <Typography
                                                        variant='caption'
                                                        color='text.secondary'
                                                    >
                                                        {link.path}
                                                    </Typography>
                                                </Box>
                                                <Select
                                                    value={link.linkShareRole}
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
                                                        <DeleteIcon fontSize='small' />
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
export const DriveAudit: React.FC = () => {
    const [folderId, setFolderId] = useState('');
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState<AuditResult | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [newLogsCount, setNewLogsCount] = useState(0);
    const [idError, setIdError] = useState('');
    const [progress, setProgress] = useState<ScanProgress>({
        foldersProcessed: 0,
        filesProcessed: 0,
    });
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
    const [estimatedFolders, setEstimatedFolders] = useState<number | null>(
        null
    );
    const [estimatedFiles, setEstimatedFiles] = useState<number | null>(null);
    const [hasPrevData, setHasPrevData] = useState(false);

    const [savedFolders, setSavedFolders] = useState<SavedFolder[]>([]);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [showFoldersDialog, setShowFoldersDialog] = useState(false);
    const [folderName, setFolderName] = useState('');

    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'accesses' | 'name'>('accesses');
    const [selectedEmployee, setSelectedEmployee] = useState<string | null>(
        null
    );
    const [viewMode, setViewMode] = useState<'employees' | 'links'>(
        'employees'
    );

    const [linkRoleFilter, setLinkRoleFilter] = useState<string>('all');
    const [linkTypeFilter, setLinkTypeFilter] = useState<string>('all');
    const [linkPathSearch, setLinkPathSearch] = useState('');

    const { setCurrentPage } = useGlobalContext();
    const logBoxRef = useRef<HTMLPreElement>(null);
    const [activeTab, setActiveTab] = useState<'employees' | 'links'>(
        'employees'
    );

    const filteredLinks = useMemo(() => {
        if (!result) return [];
        return result.linkAccesses.filter((link) => {
            const matchRole =
                linkRoleFilter === 'all' ||
                link.linkShareRole === linkRoleFilter;
            const matchType =
                linkTypeFilter === 'all' ||
                (linkTypeFilter === 'folder' && link.itemType === 'folder') ||
                (linkTypeFilter === 'file' && link.itemType !== 'folder');
            const matchPath =
                linkPathSearch === '' ||
                link.path
                    .toLowerCase()
                    .includes(linkPathSearch.toLowerCase()) ||
                link.itemName
                    .toLowerCase()
                    .includes(linkPathSearch.toLowerCase());
            return matchRole && matchType && matchPath;
        });
    }, [result, linkRoleFilter, linkTypeFilter, linkPathSearch]);

    useEffect(() => {
        loadSavedFolders();
    }, []);

    useEffect(() => {
        let unlistenProgress: (() => void) | undefined;
        let unlistenLog: (() => void) | undefined;

        listen<ScanProgress>('audit_progress', (event) => {
            setProgress(event.payload);
        }).then((fn) => {
            unlistenProgress = fn;
        });

        listen('audit_log', (event) => {
            setLogs((p) => [...p, event.payload as string]);
            if (!drawerOpen) {
                setNewLogsCount((c) => c + 1);
            }
        }).then((fn) => {
            unlistenLog = fn;
        });

        return () => {
            unlistenProgress?.();
            unlistenLog?.();
        };
    }, [drawerOpen]);

    useEffect(() => {
        if (logBoxRef.current) {
            logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        if (scanning) {
            setElapsedSeconds(0);
            setProgress({ foldersProcessed: 0, filesProcessed: 0 });
            timer = setInterval(() => {
                setElapsedSeconds((prev) => prev + 1);
            }, 1000);
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    }, [scanning]);

    useEffect(() => {
        if (scanning) {
            const currentSaved = savedFolders.find((f) => f.id === folderId);

            if (currentSaved?.lastScan) {
                setHasPrevData(true);
                setEstimatedFolders(currentSaved.lastScan.foldersCount);
                setEstimatedFiles(currentSaved.lastScan.filesCount);

                const prevFolder = currentSaved.lastScan;
                const prevTotalItems =
                    prevFolder.foldersCount + prevFolder.filesCount / 10;
                const timePerItem = prevFolder.durationSec / prevTotalItems;

                const currentItems =
                    progress.foldersProcessed + progress.filesProcessed / 10;
                const remainingItems =
                    prevFolder.foldersCount +
                    prevFolder.filesCount / 10 -
                    currentItems;

                let eta = remainingItems * timePerItem;

                let avgTimePerItem = timePerItem;
                let countSimilar = 1;
                currentSaved.scanHistory.forEach((h) => {
                    const deltaFolders =
                        Math.abs(h.foldersCount - prevFolder.foldersCount) /
                        prevFolder.foldersCount;
                    const deltaFiles =
                        Math.abs(h.filesCount - prevFolder.filesCount) /
                        prevFolder.filesCount;
                    if (deltaFolders < 0.2 && deltaFiles < 0.2) {
                        avgTimePerItem +=
                            h.durationSec /
                            (h.foldersCount + h.filesCount / 10);
                        countSimilar++;
                    }
                });
                avgTimePerItem /= countSimilar;
                eta = remainingItems * avgTimePerItem;

                if (
                    logs.some(
                        (l) => l.includes('timeout') || l.includes('rate')
                    )
                ) {
                    eta *= 1.2;
                }

                eta *= 1.15;
                if (countSimilar > 5) eta *= 1.1;

                setEtaSeconds(Math.max(0, Math.round(eta)));
            } else {
                setHasPrevData(false);
                setEstimatedFolders(null);
                setEstimatedFiles(null);
                setEtaSeconds(elapsedSeconds);
            }
        } else {
            setEtaSeconds(null);
        }
    }, [scanning, elapsedSeconds, logs, savedFolders, folderId, progress]);

    const formatSeconds = (sec: number) => {
        const min = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return `${min > 0 ? min + ' мин ' : ''}${s} сек`;
    };

    const loadSavedFolders = async () => {
        try {
            const folders = await invoke<SavedFolder[]>('get_saved_folders');
            setSavedFolders(folders);
        } catch (err) {
            console.error('Ошибка загрузки папок:', err);
        }
    };

    const handleSaveFolder = async () => {
        if (!folderId.trim() || !folderName.trim()) return;
        try {
            await invoke('save_folder', {
                folderId: folderId.trim(),
                folderName: folderName.trim(),
            });
            await loadSavedFolders();
            setShowSaveDialog(false);
            setFolderName('');
        } catch (err) {
            console.error('Ошибка сохранения:', err);
        }
    };

    const handleSelectFolder = (folder: SavedFolder) => {
        setFolderId(folder.id);
        setShowFoldersDialog(false);
        loadSavedFolders();
    };

    const handleRemoveFolder = async (
        folderId: string,
        e: React.MouseEvent
    ) => {
        e.stopPropagation();
        try {
            await invoke('remove_saved_folder', { folderId });
            await loadSavedFolders();
        } catch (err) {
            console.error('Ошибка удаления:', err);
        }
    };

    const handleIdBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
        if (!folderId.trim()) {
            setIdError('');
            return;
        }
        try {
            await invoke('is_this_folder', { itemId: folderId.trim() });
            setIdError('');
        } catch (err: any) {
            setIdError(err);
        }
    };

    const handleScan = async () => {
        if (!folderId.trim()) {
            setLogs(['Укажи ID папки']);
            return;
        }
        setScanning(true);
        setLogs([]);
        setNewLogsCount(0);
        setResult(null);
        setSelectedEmployee(null);
        setProgress({ foldersProcessed: 0, filesProcessed: 0 });
        setElapsedSeconds(0);
        setEtaSeconds(null);
        setHasPrevData(false);

        try {
            const data = await invoke<AuditResult>('audit_drive', {
                folderId: folderId.trim(),
            });
            setResult(data);
            await loadSavedFolders();
        } catch (e: any) {
            setLogs([`Ошибка: ${e}`]);
        } finally {
            setScanning(false);
        }
    };

    const removeAccess = async (
        itemId: string,
        permissionId: string,
        employeeEmail?: string
    ) => {
        try {
            await invoke('remove_permission', { itemId, permissionId });
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
            setLogs((p) => [...p, `✅ Доступ удалён`]);
        } catch (e: any) {
            setLogs((p) => [...p, `Ошибка удаления: ${e}`]);
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
            setLogs((p) => [...p, `Ошибка: ${e}`]);
        }
    };

    const exportEmployee = async (emp: EmployeeAccess) => {
        try {
            await invoke('export_employee_data', { employee: emp });
        } catch (e: any) {
            setLogs((p) => [...p, `Экспорт: ${e}`]);
        }
    };

    const exportAll = async () => {
        if (!result) return;
        try {
            await invoke('export_all_employees', { auditResult: result });
        } catch (e: any) {
            setLogs((p) => [...p, e.message]);
        }
    };

    const exportLinks = async () => {
        if (!result) return;
        try {
            await invoke('export_links_data', { auditResult: result });
        } catch (e: any) {
            setLogs((p) => [...p, e.message]);
        }
    };

    const roleToRu = (r: string) =>
        ({
            owner: 'Владелец',
            writer: 'Редактор',
            commenter: 'Комментатор',
            reader: 'Просмотр',
        })[r] ?? r;

    const filteredEmployees = useMemo(() => {
        if (!result) return [];
        let filtered = result.employees.filter((emp) => {
            const matchSearch =
                searchQuery === '' ||
                emp.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                emp.displayName
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase());
            const matchRole =
                roleFilter === 'all' || emp.roles[roleFilter] !== undefined;
            return matchSearch && matchRole;
        });
        if (sortBy === 'accesses') {
            filtered.sort((a, b) => b.totalAccess - a.totalAccess);
        } else {
            filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
        }
        return filtered;
    }, [result, searchQuery, roleFilter, sortBy]);

    const selectedEmpData = useMemo(() => {
        if (!selectedEmployee || !result) return null;
        return result.employees.find((e) => e.email === selectedEmployee);
    }, [selectedEmployee, result]);

    const totalAccesses = result
        ? result.employees.reduce((sum, emp) => sum + emp.totalAccess, 0)
        : 0;

    const handleOpenDrawer = () => {
        setDrawerOpen(true);
        setNewLogsCount(0);
    };

    if (!result) {
        return (
            <Box
                sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    py: 4,
                    background: (theme) =>
                        `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
                }}
            >
                <Container maxWidth='md'>
                    <Card
                        sx={{
                            p: 5,
                            borderRadius: 3,
                            boxShadow: (theme) =>
                                `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
                        }}
                    >
                        {/* Header */}
                        <Box sx={{ mb: 4 }}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    mb: 2,
                                }}
                            >
                                <IconButton
                                    onClick={() => setCurrentPage('main')}
                                    sx={{
                                        bgcolor: alpha('#1976d2', 0.1),
                                        '&:hover': {
                                            bgcolor: alpha('#1976d2', 0.2),
                                        },
                                    }}
                                >
                                    <ArrowBackIcon />
                                </IconButton>
                                <Typography
                                    variant='h4'
                                    component='h1'
                                    sx={{
                                        fontWeight: 800,
                                        background:
                                            'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                                        backgroundClip: 'text',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                    }}
                                >
                                    Аудит доступов
                                </Typography>
                            </Box>
                            <Typography
                                variant='body2'
                                sx={{ color: 'text.secondary' }}
                            >
                                Просмотр и управление доступами к файлам и
                                папкам
                            </Typography>
                        </Box>

                        {/* Folder ID Input */}
                        <Box sx={{ mb: 3 }}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    mb: 1.5,
                                }}
                            >
                                <Typography
                                    variant='subtitle2'
                                    sx={{ fontWeight: 600 }}
                                >
                                    Корневая папка
                                </Typography>
                                <Tooltip
                                    title={
                                        <Box>
                                            <Typography
                                                variant='caption'
                                                sx={{
                                                    display: 'block',
                                                    mb: 0.5,
                                                }}
                                            >
                                                Откройте папку в Google Drive
                                            </Typography>
                                            <Typography
                                                variant='caption'
                                                sx={{
                                                    display: 'block',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.7rem',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                drive.google.com/drive/folders/
                                                <strong>1EHOqUs...</strong>
                                            </Typography>
                                            <Typography
                                                variant='caption'
                                                sx={{
                                                    display: 'block',
                                                    mt: 0.5,
                                                }}
                                            >
                                                Скопируйте часть после /folders/
                                                целиком
                                            </Typography>
                                        </Box>
                                    }
                                    arrow
                                >
                                    <HelpOutlineIcon
                                        sx={{
                                            fontSize: 18,
                                            color: 'text.secondary',
                                            cursor: 'help',
                                        }}
                                    />
                                </Tooltip>
                            </Box>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                    fullWidth
                                    value={folderId}
                                    onChange={(e) =>
                                        setFolderId(e.target.value)
                                    }
                                    placeholder='1EHOqUs...'
                                    disabled={scanning}
                                    onBlur={handleIdBlur}
                                    error={Boolean(idError)}
                                    helperText={idError}
                                    sx={{
                                        '& .MuiInputBase-root': {
                                            fontFamily: 'monospace',
                                            fontSize: 14,
                                        },
                                    }}
                                />
                                <FolderSelector
                                    folderId={folderId}
                                    isScanning={scanning}
                                    hasIdError={Boolean(idError)}
                                    savedFolders={savedFolders}
                                    onFolderSelect={setFolderId}
                                    onFoldersUpdate={loadSavedFolders}
                                />
                            </Box>
                        </Box>

                        {/* Action Buttons */}
                        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                            <Button
                                variant='contained'
                                fullWidth
                                onClick={handleScan}
                                disabled={
                                    scanning ||
                                    !folderId.trim() ||
                                    Boolean(idError)
                                }
                                startIcon={<PlayArrowIcon />}
                                sx={{
                                    py: 1.5,
                                    fontWeight: 600,
                                    textTransform: 'none',
                                    fontSize: 16,
                                }}
                            >
                                {scanning
                                    ? `Сканирование... ${formatSeconds(elapsedSeconds)}`
                                    : 'Запустить аудит'}
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

                            {scanning && (
                                <>
                                    <Button
                                        variant='outlined'
                                        color='error'
                                        onClick={async () => {
                                            await invoke('cancel_audit_drive');
                                            setScanning(false);
                                            setElapsedSeconds(0);
                                            setEtaSeconds(null);
                                        }}
                                        startIcon={<StopIcon />}
                                        sx={{
                                            minWidth: '140px',
                                            fontWeight: 600,
                                            textTransform: 'none',
                                        }}
                                    >
                                        Отменить
                                    </Button>
                                </>
                            )}
                        </Box>

                        {/* Progress Bar */}
                        {scanning && (
                            <Card
                                sx={{
                                    p: 3,
                                    mb: 3,
                                    bgcolor: alpha('#1976d2', 0.05),
                                    border: 1,
                                    borderColor: alpha('#1976d2', 0.2),
                                }}
                            >
                                <LinearProgress
                                    variant={
                                        hasPrevData
                                            ? 'determinate'
                                            : 'indeterminate'
                                    }
                                    value={
                                        hasPrevData &&
                                        estimatedFolders &&
                                        estimatedFiles
                                            ? ((progress.foldersProcessed +
                                                  progress.filesProcessed /
                                                      10) /
                                                  (estimatedFolders +
                                                      estimatedFiles / 10)) *
                                              100
                                            : undefined
                                    }
                                    sx={{
                                        height: 8,
                                        borderRadius: 1,
                                        bgcolor: alpha('#000', 0.1),
                                        '& .MuiLinearProgress-bar': {
                                            bgcolor: 'primary.main',
                                        },
                                    }}
                                />
                                <Box
                                    sx={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        mt: 2,
                                        flexWrap: 'wrap',
                                        gap: 1,
                                    }}
                                >
                                    <Chip
                                        label={`Прошло: ${formatSeconds(elapsedSeconds)}`}
                                        size='small'
                                        sx={{ fontWeight: 500 }}
                                    />
                                    {etaSeconds !== null && (
                                        <Chip
                                            label={`Осталось ≈ ${formatSeconds(etaSeconds)}`}
                                            size='small'
                                            color='primary'
                                            sx={{ fontWeight: 500 }}
                                        />
                                    )}
                                </Box>
                                <Typography
                                    variant='caption'
                                    sx={{
                                        display: 'block',
                                        mt: 1.5,
                                        textAlign: 'center',
                                        color: 'text.secondary',
                                    }}
                                >
                                    Обработано: {progress.foldersProcessed}{' '}
                                    папок / {progress.filesProcessed} файлов
                                    {hasPrevData &&
                                        estimatedFolders &&
                                        estimatedFiles && (
                                            <>
                                                {' '}
                                                / ~{estimatedFolders} папок / ~
                                                {estimatedFiles} файлов
                                            </>
                                        )}
                                </Typography>
                            </Card>
                        )}

                        {/* Tree View */}
                        {scanning && (
                            <Card
                                sx={{
                                    mb: 3,
                                    height: 600,
                                    overflow: 'hidden',
                                    border: 1,
                                    borderColor: 'divider',
                                }}
                            >
                                <AuditTree />
                            </Card>
                        )}
                    </Card>
                </Container>
            </Box>
        );
    }

    // Results View
    return (
        <Box
            sx={{
                minHeight: '100vh',
                background: (theme) =>
                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
                p: 3,
            }}
        >
            {/* Header */}
            <Box sx={{ mb: 3 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        mb: 2,
                    }}
                >
                    <IconButton
                        onClick={() => setResult(null)}
                        sx={{
                            bgcolor: alpha('#1976d2', 0.1),
                            '&:hover': { bgcolor: alpha('#1976d2', 0.2) },
                        }}
                    >
                        <ArrowBackIcon />
                    </IconButton>
                    <Typography
                        variant='h4'
                        sx={{
                            fontWeight: 800,
                            flex: 1,
                            background:
                                'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                            backgroundClip: 'text',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                        }}
                    >
                        Результаты аудита
                    </Typography>
                    <Button
                        variant='outlined'
                        startIcon={<DescriptionIcon />}
                        onClick={
                            activeTab === 'employees' ? exportAll : exportLinks
                        }
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Экспорт{' '}
                        {activeTab === 'employees' ? 'сотрудников' : 'ссылок'}
                    </Button>
                </Box>
            </Box>

            {/* Stats Cards */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 2,
                    mb: 3,
                }}
            >
                <Card
                    sx={{
                        p: 3,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'divider',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': {
                            borderColor: 'primary.main',
                            transform: 'translateY(-2px)',
                            boxShadow: (theme) =>
                                `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}`,
                        },
                    }}
                    onClick={() => setActiveTab('employees')}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            mb: 1,
                        }}
                    >
                        <PeopleIcon
                            sx={{ color: 'primary.main', fontSize: 28 }}
                        />
                        <Typography
                            variant='h3'
                            sx={{ fontWeight: 700 }}
                        >
                            {result.employees.length}
                        </Typography>
                    </Box>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{ fontWeight: 500 }}
                    >
                        Сотрудников
                    </Typography>
                </Card>

                <Card
                    sx={{
                        p: 3,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'divider',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': {
                            borderColor: 'primary.main',
                            transform: 'translateY(-2px)',
                            boxShadow: (theme) =>
                                `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}`,
                        },
                    }}
                    onClick={() => setActiveTab('links')}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            mb: 1,
                        }}
                    >
                        <LinkIcon
                            sx={{ color: 'primary.main', fontSize: 28 }}
                        />
                        <Typography
                            variant='h3'
                            sx={{ fontWeight: 700 }}
                        >
                            {result.linkAccesses.length}
                        </Typography>
                    </Box>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{ fontWeight: 500 }}
                    >
                        Ссылок
                    </Typography>
                </Card>

                <Card
                    sx={{
                        p: 3,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            mb: 1,
                        }}
                    >
                        <AssessmentIcon
                            sx={{ color: 'primary.main', fontSize: 28 }}
                        />
                        <Typography
                            variant='h3'
                            sx={{ fontWeight: 700 }}
                        >
                            {totalAccesses}
                        </Typography>
                    </Box>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{ fontWeight: 500 }}
                    >
                        Всего доступов
                    </Typography>
                </Card>
            </Box>

            {/* Tabs */}
            <Card sx={{ mb: 2 }}>
                <Tabs
                    value={activeTab}
                    onChange={(_, v) => setActiveTab(v)}
                    sx={{
                        borderBottom: 1,
                        borderColor: 'divider',
                        '& .MuiTab-root': {
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: 16,
                        },
                    }}
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
            </Card>

            {/* Tab Content */}
            {activeTab === 'employees' ? (
                <EmployeesView
                    result={result}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    roleFilter={roleFilter}
                    setRoleFilter={setRoleFilter}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                    selectedEmployee={selectedEmployee}
                    setSelectedEmployee={setSelectedEmployee}
                    exportEmployee={exportEmployee}
                    roleToRu={roleToRu}
                    filteredEmployees={filteredEmployees}
                    selectedEmpData={selectedEmpData}
                />
            ) : (
                <LinksView
                    filteredLinks={filteredLinks}
                    linkPathSearch={linkPathSearch}
                    setLinkPathSearch={setLinkPathSearch}
                    linkRoleFilter={linkRoleFilter}
                    setLinkRoleFilter={setLinkRoleFilter}
                    linkTypeFilter={linkTypeFilter}
                    setLinkTypeFilter={setLinkTypeFilter}
                    updateLinkRole={updateLinkRole}
                    removeAccess={removeAccess}
                />
            )}
        </Box>
    );
};
