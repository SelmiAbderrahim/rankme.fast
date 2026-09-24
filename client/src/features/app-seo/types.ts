export interface AppProfile {
  id: string;
  siteId: string;
  playPackageId: string | null;
  appStoreId: string | null;
  paired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterAppProfileInput {
  playPackageId?: string;
  appStoreId?: string;
  paired: boolean;
}

export type RegistrationStatus =
  | 'idle'
  | 'loading'
  | 'succeeded'
  | 'failed'
  | 'unavailable';

export interface AppSeoRegistrationState {
  status: RegistrationStatus;
  message: string;
}

export interface AppSeoState {
  profiles: AppProfile[];
  registration: AppSeoRegistrationState;
}
