import React, { useMemo, useState } from 'react';
import {
    alpha,
    Box,
    Card,
    IconButton,
    Tab,
    Tabs,
    Typography,
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon,
    Assessment as AssessmentIcon,
    DeleteSweep as DeleteSweepIcon,
    Link as LinkIcon,
    People as PeopleIcon,
    VpnKey,
} from '@mui/icons-material';
import { AuditResult, EmployeeStats } from '../types/interfaces.ts';
import EmployeeDetailView from './Views/EmployeeDetailView.tsx';
import LinksView from './Views/LinksView.tsx';
import CopiedItemsView from './Views/CopiedItemsView.tsx';
import EmployeesView from './Views/EmployeeView.tsx';

interface Props {
    result: AuditResult;
    onBack: () => void;
}

export const AuditResults: React.FC<Props> = ({ result, onBack }) => {
    const [activeTab, setActiveTab] = useState<
        'employees' | 'links' | 'copied'
    >('employees');
    const [selectedEmployee, setSelectedEmployee] = useState<string | null>(
        null
    );
    const [bulkMode, setBulkMode] = useState(false);
    const [bulkEmailsInput, setBulkEmailsInput] = useState('');
    const [employeesScrollOffset, setEmployeesScrollOffset] = useState(0);
    const [logs, setLogs] = useState<string[]>([]);
    const [localResult, setLocalResult] = useState(result);

    const copiedCount = useMemo(() => {
        if (!localResult) return 0;
        return Object.values(localResult.items).filter(
            (item: any) => item.properties.is_copied === 'true'
        ).length;
    }, [localResult]);

    const totalItems = useMemo(
        () => Object.keys(localResult.items).length,
        [localResult]
    );

    const employeesCount = useMemo(
        () =>
            Object.keys(localResult.emailIndex).filter((e) => e !== '__link__')
                .length,
        [localResult]
    );

    const linksCount = useMemo(
        () => (localResult.emailIndex['__link__'] || []).length,
        [localResult]
    );

    const accessesCount = useMemo(
        () =>
            Object.values(localResult.stats).reduce(
                (acc, stat) => acc + stat.totalItems,
                0
            ),
        [localResult]
    );

    // Статистика по ролям
    const roleStats = useMemo(() => {
        const stats = {
            owners: 0,
            organizers: 0,
            editors: 0,
            commenters: 0,
            viewers: 0,
        };

        Object.values(localResult.stats).forEach((s: EmployeeStats) => {
            stats.owners += s.owners;
            stats.organizers += s.organizers + s.fileOrganizers;
            stats.editors += s.editors;
            stats.commenters += s.commenters;
            stats.viewers += s.viewers;
        });

        return stats;
    }, [localResult]);

    // Данные для PieChart
    const pieData = useMemo(() => {
        return [
            { name: 'Владельцы', value: roleStats.owners, color: '#f44336' },
            {
                name: 'Организаторы',
                value: roleStats.organizers,
                color: '#ff9800',
            },
            { name: 'Редакторы', value: roleStats.editors, color: '#ff9800' },
            {
                name: 'Комментаторы',
                value: roleStats.commenters,
                color: '#9e9e9e',
            },
            { name: 'Просмотр', value: roleStats.viewers, color: '#2196f3' },
        ].filter((item) => item.value > 0);
    }, [roleStats]);

    // Топ-10 сотрудников
    const topEmployees = useMemo(() => {
        return Object.entries(localResult.emailIndex)
            .filter(([email]) => email !== '__link__')
            .map(([email, entries]) => ({
                email: email.split('@')[0], // только имя до @
                fullEmail: email,
                count: entries.length,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }, [localResult]);

    const updateResult = (newResult: AuditResult) => {
        const stats: Record<string, EmployeeStats> = {};

        Object.entries(newResult.emailIndex).forEach(([email, entries]) => {
            const s: EmployeeStats = {
                totalItems: entries.length,
                owners: 0,
                organizers: 0,
                fileOrganizers: 0,
                editors: 0,
                commenters: 0,
                viewers: 0,
                linkAccesses: 0,
            };

            entries.forEach(([itemId, permIdx]) => {
                const item = newResult.items[itemId];
                if (!item) return;
                const perm = item.permissions[permIdx];
                if (!perm) return;

                if (perm.isLink) {
                    s.linkAccesses += 1;
                } else {
                    switch (perm.role) {
                        case 'owner':
                            s.owners += 1;
                            break;
                        case 'organizer':
                            s.organizers += 1;
                            break;
                        case 'fileOrganizer':
                            s.fileOrganizers += 1;
                            break;
                        case 'editor':
                            s.editors += 1;
                            break;
                        case 'commenter':
                            s.commenters += 1;
                            break;
                        case 'viewer':
                            s.viewers += 1;
                            break;
                    }
                }
            });

            stats[email] = s;
        });

        setLocalResult({ ...newResult, stats });
    };

    const addLog = (msg: string) => {
        setLogs((p) => [...p, msg]);
    };

    const formatDate = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            return date.toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return dateStr;
        }
    };

    if (selectedEmployee) {
        return (
            <Box
                sx={{
                    minHeight: '100vh',
                    background: (theme) =>
                        `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
                    p: 3,
                }}
            >
                <EmployeeDetailView
                    email={selectedEmployee}
                    result={localResult}
                    onBack={() => setSelectedEmployee(null)}
                    onLogsUpdate={addLog}
                    logs={logs}
                    onResultUpdate={updateResult}
                />
            </Box>
        );
    }

    return (
        <Box
            sx={{
                minHeight: '100vh',
                background: (theme) =>
                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.background.default, 1)} 100%)`,
                p: 3,
            }}
        >
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
                        onClick={onBack}
                        sx={{
                            bgcolor: alpha('#1976d2', 0.1),
                            '&:hover': { bgcolor: alpha('#1976d2', 0.2) },
                        }}
                    >
                        <ArrowBackIcon />
                    </IconButton>
                    <Box sx={{ flex: 1 }}>
                        <Typography
                            variant='h4'
                            sx={{
                                fontWeight: 800,
                                background:
                                    'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
                                backgroundClip: 'text',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                            }}
                        >
                            Результаты аудита
                        </Typography>
                        <Typography
                            variant='body2'
                            color='text.secondary'
                            sx={{ mt: 0.5 }}
                        >
                            Сканирование: {formatDate(localResult.scanDate)}
                        </Typography>
                    </Box>
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
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
                            {employeesCount}
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
                            {linksCount}
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
                        borderColor:
                            copiedCount > 0 ? 'warning.main' : 'divider',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        bgcolor:
                            copiedCount > 0
                                ? alpha('#ff9800', 0.05)
                                : 'transparent',
                        '&:hover': {
                            borderColor: 'warning.main',
                            transform: 'translateY(-2px)',
                        },
                    }}
                    onClick={() => setActiveTab('copied')}
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
                        <DeleteSweepIcon
                            sx={{ color: 'warning.main', fontSize: 28 }}
                        />
                        <Typography
                            variant='h3'
                            sx={{ fontWeight: 700 }}
                        >
                            {copiedCount}
                        </Typography>
                    </Box>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{ fontWeight: 500 }}
                    >
                        К удалению
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
                            {totalItems}
                        </Typography>
                    </Box>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{ fontWeight: 500 }}
                    >
                        Всего элементов
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
                        <VpnKey sx={{ color: 'primary.main', fontSize: 28 }} />
                        <Typography
                            variant='h3'
                            sx={{ fontWeight: 700 }}
                        >
                            {accessesCount}
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

            {/* Разбивка по ролям */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: 2,
                    mb: 3,
                }}
            >
                <Card
                    sx={{
                        p: 2,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'error.main',
                        bgcolor: alpha('#f44336', 0.05),
                    }}
                >
                    <Typography
                        variant='h4'
                        sx={{ fontWeight: 700, color: 'error.main' }}
                    >
                        {roleStats.owners}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        👑 Владельцев
                    </Typography>
                </Card>
                <Card
                    sx={{
                        p: 2,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Typography
                        variant='h4'
                        sx={{ fontWeight: 700 }}
                    >
                        {roleStats.organizers}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        🔧 Организаторов
                    </Typography>
                </Card>
                <Card
                    sx={{
                        p: 2,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'warning.main',
                        bgcolor: alpha('#ff9800', 0.05),
                    }}
                >
                    <Typography
                        variant='h4'
                        sx={{ fontWeight: 700, color: 'warning.main' }}
                    >
                        {roleStats.editors}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        ✏️ Редакторов
                    </Typography>
                </Card>
                <Card
                    sx={{
                        p: 2,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Typography
                        variant='h4'
                        sx={{ fontWeight: 700 }}
                    >
                        {roleStats.commenters}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        💬 Комментаторов
                    </Typography>
                </Card>
                <Card
                    sx={{
                        p: 2,
                        textAlign: 'center',
                        border: 1,
                        borderColor: 'info.main',
                        bgcolor: alpha('#2196f3', 0.05),
                    }}
                >
                    <Typography
                        variant='h4'
                        sx={{ fontWeight: 700, color: 'info.main' }}
                    >
                        {roleStats.viewers}
                    </Typography>
                    <Typography
                        variant='body2'
                        color='text.secondary'
                    >
                        👁️ Просмотр
                    </Typography>
                </Card>
            </Box>

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
                        label={`Сотрудники (${employeesCount})`}
                        value='employees'
                    />
                    <Tab
                        label={`Ссылки (${linksCount})`}
                        value='links'
                    />
                    <Tab
                        label={`К удалению (${copiedCount})`}
                        value='copied'
                        sx={{
                            color: copiedCount > 0 ? 'warning.main' : undefined,
                        }}
                    />
                </Tabs>
            </Card>

            {activeTab === 'employees' ? (
                <EmployeesView
                    result={localResult}
                    onSelectEmployee={setSelectedEmployee}
                    onLogsUpdate={addLog}
                    logs={logs}
                    bulkMode={bulkMode}
                    onBulkModeChange={setBulkMode}
                    bulkEmailsInput={bulkEmailsInput}
                    onBulkEmailsInputChange={setBulkEmailsInput}
                    scrollOffset={employeesScrollOffset}
                    onScrollOffsetChange={setEmployeesScrollOffset}
                />
            ) : activeTab === 'links' ? (
                <LinksView
                    result={localResult}
                    onLogsUpdate={addLog}
                />
            ) : (
                <CopiedItemsView
                    result={localResult}
                    onLogsUpdate={addLog}
                    onResultUpdate={updateResult}
                    logs={logs}
                />
            )}
        </Box>
    );
};
