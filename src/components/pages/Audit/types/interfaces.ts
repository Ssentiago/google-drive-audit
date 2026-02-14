export type Role =
    | 'owner'
    | 'organizer'
    | 'fileOrganizer'
    | 'editor'
    | 'commenter'
    | 'viewer';

export interface Permission {
    email: string;
    role: Role;
    permissionId: string;
    isLink: boolean;
}

export interface Item {
    id: string;
    name: string;
    path: string;
    mimeType: string;
    parentId: string | null;
    permissions: Permission[];
    properties: Record<string, string>;
}

export interface EmployeeStats {
    totalItems: number;
    owners: number;
    organizers: number;
    fileOrganizers: number;
    editors: number;
    commenters: number;
    viewers: number;
    linkAccesses: number;
}

export interface AuditResult {
    items: Record<string, Item>;
    emailIndex: Record<string, Array<[string, number]>>;
    stats: Record<string, EmployeeStats>;
    scanDate: string;
}

export interface AccessDetail {
    itemId: string;
    itemName: string;
    itemType: 'file' | 'folder';
    path: string;
    role: Permission['role'];
    permissionId: string;
    isOwner: boolean;
    parentId: string | null;
}

export interface ScanProgress {
    foldersProcessed: number;
    filesProcessed: number;
}

export interface UndeletedOriginal {
    copyId: string;
    copyName: string;
    copyUrl: string | null;
    originalId: string;
    originalName: string;
    originalUrl: string | null;
    path: string;
}
