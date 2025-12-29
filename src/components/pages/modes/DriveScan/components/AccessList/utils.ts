import { Access } from '../../../../../../core/ScanContext.tsx';
import { UniqueKey } from './types/types.ts';

export const getUniqueKey = (item: Access): UniqueKey => {
    if (item.roleType === 'owner') return `${item.itemId}:owner`;
    return `${item.itemId}:${item.permissionId}`;
};
