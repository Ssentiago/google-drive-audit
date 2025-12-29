// ============ SEARCH VIEW ============
import React, { useMemo, useRef } from 'react';
import { Access } from '../../../../../../../core/ScanContext.tsx';
import { Box, Button, Typography } from '@mui/material';
import { AutoSizer, List } from 'react-virtualized';
import { UniqueKey } from '../types/types.ts';
import { getUniqueKey } from '../utils.ts';

export const SearchView: React.FC<{
    access: Access[];
    selectedItems: Set<UniqueKey>;
    onToggleItem: (item: Access) => void;
    onSelectAll: () => void;
    onSelectFiltered: (items: Access[]) => void;
    onClearSelection: () => void;
    searchUser: string;
    onSearchUserChange: (val: string) => void;
    searchFileName: string;
    onSearchFileNameChange: (val: string) => void;
    searchPath: string;
    onSearchPathChange: (val: string) => void;
    filterAccessLevel: 'all' | 'owner' | 'editor' | 'viewer' | 'commenter';
    onFilterAccessLevelChange: (
        val: 'all' | 'owner' | 'editor' | 'viewer' | 'commenter'
    ) => void;
    sortBy: 'name' | 'user' | 'path' | 'level';
    onSortByChange: (val: 'name' | 'user' | 'path' | 'level') => void;
}> = ({
    access,
    selectedItems,
    onToggleItem,
    onSelectAll,
    onSelectFiltered,
    onClearSelection,
    searchUser,
    onSearchUserChange,
    searchFileName,
    onSearchFileNameChange,
    searchPath,
    onSearchPathChange,
    filterAccessLevel,
    onFilterAccessLevelChange,
    sortBy,
    onSortByChange,
}) => {
    const listRef = useRef<any>(null);

    const filteredAndSorted = useMemo(() => {
        let result = [...access];

        if (searchUser.trim()) {
            const lower = searchUser.toLowerCase();
            result = result.filter(
                (item) =>
                    item.user.toLowerCase().includes(lower) ||
                    item.email.toLowerCase().includes(lower)
            );
        }

        if (searchFileName.trim()) {
            const lower = searchFileName.toLowerCase();
            result = result.filter((item) =>
                item.name.toLowerCase().includes(lower)
            );
        }

        if (searchPath.trim()) {
            const lower = searchPath.toLowerCase();
            result = result.filter((item) =>
                item.path.toLowerCase().includes(lower)
            );
        }

        if (filterAccessLevel !== 'all') {
            if (filterAccessLevel === 'owner') {
                result = result.filter((item) => item.role === 'Владелец');
            } else if (filterAccessLevel === 'editor') {
                result = result.filter((item) => item.role === 'Редактор');
            } else if (filterAccessLevel === 'viewer') {
                result = result.filter((item) => item.role == 'Просмотр');
            } else if (filterAccessLevel == 'commenter') {
                result = result.filter((item) => item.role == 'Комментатор');
            }
        }

        result.sort((a, b) => {
            if (sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else if (sortBy === 'user') {
                return a.user.localeCompare(b.user);
            } else if (sortBy === 'path') {
                return a.path.localeCompare(b.path);
            } else if (sortBy === 'level') {
                const getLevelPriority = (item: Access) => {
                    if (item.role === 'Владелец') return 0;
                    if (item.role === 'Редактор') return 1;
                    if (item.role === 'Комментатор') return 2;
                    if (item.role === 'Просмотр') return 3;
                };
                return getLevelPriority(a) - getLevelPriority(b);
            }
            return 0;
        });

        return result;
    }, [
        access,
        searchUser,
        searchFileName,
        searchPath,
        filterAccessLevel,
        sortBy,
    ]);

    const allFilteredSelected =
        filteredAndSorted.length > 0 &&
        filteredAndSorted.every((item) =>
            selectedItems.has(getUniqueKey(item))
        );

    const rowRenderer = ({ index, key, style }: any) => {
        const item = filteredAndSorted[index];
        if (!item) return null;

        const isSelected = selectedItems.has(getUniqueKey(item));
        const canSelect = item.roleType === 'owner' || item.permissionId;

        return (
            <div
                key={key}
                style={style}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        px: 2,
                        py: 1.5,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        cursor: canSelect ? 'pointer' : 'default',
                        bgcolor: isSelected ? 'primary.100' : 'transparent',
                        '&:hover': canSelect
                            ? {
                                  bgcolor: isSelected
                                      ? 'primary.200'
                                      : 'action.hover',
                              }
                            : {},
                        opacity: canSelect ? 1 : 0.6,
                    }}
                    onClick={() => {
                        if (canSelect) onToggleItem(item);
                    }}
                >
                    <Typography sx={{ fontSize: 20, flexShrink: 0 }}>
                        {item.itemType === 'Папка' ? '📁' : '📄'}
                    </Typography>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            sx={{
                                fontWeight: 600,
                                fontSize: 14,
                                mb: 0.5,
                            }}
                        >
                            {item.name}
                        </Typography>
                        <Typography
                            variant='caption'
                            color='text.secondary'
                        >
                            {item.path || 'Корень'}
                        </Typography>
                    </Box>

                    <Box sx={{ minWidth: 150, flexShrink: 0 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                            {item.user}
                        </Typography>
                        <Typography
                            variant='caption'
                            color='text.secondary'
                        >
                            {item.email}
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            px: 1.5,
                            py: 0.5,
                            bgcolor:
                                item.role === 'Владелец'
                                    ? 'error.main'
                                    : item.role === 'Редактор'
                                      ? 'warning.main'
                                      : item.role === 'Комментатор'
                                        ? 'secondary.main'
                                        : item.role === 'Просмотр'
                                          ? 'info.main'
                                          : 'grey.500',
                            color: 'white',
                            borderRadius: 1,
                            fontSize: 11,
                            fontWeight: 700,
                            flexShrink: 0,
                        }}
                    >
                        {item.role === 'owner' ? '👑 Владелец' : item.role}
                    </Box>
                </Box>
            </div>
        );
    };

    return (
        <Box>
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2,
                }}
            >
                <Typography
                    variant='h6'
                    sx={{ fontWeight: 600 }}
                >
                    🔍 Поиск и фильтрация
                </Typography>

                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        variant='contained'
                        size='small'
                        onClick={onSelectAll}
                    >
                        Выделить все ({access.length})
                    </Button>
                    {filteredAndSorted.length < access.length && (
                        <Button
                            variant='outlined'
                            size='small'
                            onClick={() => onSelectFiltered(filteredAndSorted)}
                        >
                            Выделить найденные ({filteredAndSorted.length})
                        </Button>
                    )}
                    {selectedItems.size > 0 && (
                        <Button
                            variant='outlined'
                            color='error'
                            size='small'
                            onClick={onClearSelection}
                        >
                            Снять ({selectedItems.size})
                        </Button>
                    )}
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 2,
                    mb: 2,
                }}
            >
                <Box>
                    <Typography
                        variant='caption'
                        sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}
                    >
                        Пользователь:
                    </Typography>
                    <input
                        type='text'
                        placeholder='Имя или email...'
                        value={searchUser}
                        onChange={(e) => onSearchUserChange(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }}
                    />
                </Box>

                <Box>
                    <Typography
                        variant='caption'
                        sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}
                    >
                        Имя файла:
                    </Typography>
                    <input
                        type='text'
                        placeholder='report.pdf...'
                        value={searchFileName}
                        onChange={(e) => onSearchFileNameChange(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }}
                    />
                </Box>

                <Box>
                    <Typography
                        variant='caption'
                        sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}
                    >
                        Путь:
                    </Typography>
                    <input
                        type='text'
                        placeholder='Projects/Finance...'
                        value={searchPath}
                        onChange={(e) => onSearchPathChange(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }}
                    />
                </Box>

                <Box>
                    <Typography
                        variant='caption'
                        sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}
                    >
                        Уровень доступа:
                    </Typography>
                    <select
                        value={filterAccessLevel}
                        onChange={(e) =>
                            onFilterAccessLevelChange(
                                e.target.value as
                                    | 'all'
                                    | 'owner'
                                    | 'editor'
                                    | 'viewer'
                            )
                        }
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }}
                    >
                        <option value='all'>Все</option>
                        <option value='owner'>👑 Владельцы</option>
                        <option value='editor'>✏️ Редакторы</option>
                        <option value='viewer'>👁️ Просмотр</option>
                        <option value={'commenter'}>💬Комментатор</option>
                    </select>
                </Box>

                <Box>
                    <Typography
                        variant='caption'
                        sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}
                    >
                        Сортировка:
                    </Typography>
                    <select
                        value={sortBy}
                        onChange={(e) =>
                            onSortByChange(
                                e.target.value as
                                    | 'name'
                                    | 'user'
                                    | 'path'
                                    | 'level'
                            )
                        }
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            fontSize: '14px',
                        }}
                    >
                        <option value='level'>По критичности</option>
                        <option value='name'>По имени файла</option>
                        <option value='user'>По пользователю</option>
                        <option value='path'>По пути</option>
                    </select>
                </Box>
            </Box>

            <Typography
                variant='body2'
                color='text.secondary'
                sx={{ mb: 2 }}
            >
                Найдено: {filteredAndSorted.length} из {access.length}
            </Typography>

            <Box
                sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    height: 600,
                }}
            >
                {filteredAndSorted.length === 0 ? (
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
                            <List
                                ref={listRef}
                                height={height}
                                width={width}
                                rowCount={filteredAndSorted.length}
                                rowHeight={70}
                                rowRenderer={rowRenderer}
                            />
                        )}
                    </AutoSizer>
                )}
            </Box>
        </Box>
    );
};
