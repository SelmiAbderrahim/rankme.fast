import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Check, Copy, KeyRound, SlidersHorizontal } from 'lucide-react';
import {
  loadSites,
  selectSites,
  selectSitesError,
  selectSitesLoaded,
  selectSitesLoading,
} from '@features/sites';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { DocsLink } from '@shared/docs/DocsLink';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Input } from '@shared/ui/input';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@shared/ui/field';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { clearApiKeysMessages, clearCreatedApiKey } from '../store/apiKeysSlice';
import {
  createApiKey,
  loadApiKeys,
  revokeApiKey,
  updateApiKeyScopes,
} from '../store/apiKeysThunks';
import {
  selectApiKeyCreateError,
  selectApiKeyCreating,
  selectApiKeyRevokeError,
  selectApiKeyRevokingId,
  selectApiKeyScopesError,
  selectApiKeyScopesSavingId,
  selectApiKeys,
  selectApiKeysLoadError,
  selectApiKeysLoaded,
  selectApiKeysLoading,
  selectApiKeysMessage,
  selectCreatedApiKey,
} from '../store/apiKeysSelectors';
import { createPermissiveMcpSettings, materializeMcpSpec, toMcpPermissionSpec } from '../mcpScopes';
import type { ApiKeySummary, McpPermissionSettings } from '../types';
import { McpScopeFields } from './McpScopeFields';

const nameSchema = z.string().trim().min(1).max(60);

/**
 * `/profile?tab=api-keys` — list, create (show-once reveal), and revoke the
 * account's MCP and public-API keys.
 */
export const ApiKeysPanel = () => {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const dispatch = useAppDispatch();
  const keys = useAppSelector(selectApiKeys);
  const loading = useAppSelector(selectApiKeysLoading);
  const loaded = useAppSelector(selectApiKeysLoaded);
  const loadError = useAppSelector(selectApiKeysLoadError);
  const creating = useAppSelector(selectApiKeyCreating);
  const createError = useAppSelector(selectApiKeyCreateError);
  const createdKey = useAppSelector(selectCreatedApiKey);
  const revokingId = useAppSelector(selectApiKeyRevokingId);
  const revokeError = useAppSelector(selectApiKeyRevokeError);
  const scopesSavingId = useAppSelector(selectApiKeyScopesSavingId);
  const scopesError = useAppSelector(selectApiKeyScopesError);
  const message = useAppSelector(selectApiKeysMessage);
  const sites = useAppSelector(selectSites);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const sitesError = useAppSelector(selectSitesError);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);
  const [createScopesEnabled, setCreateScopesEnabled] = useState(false);
  const [createScopes, setCreateScopes] = useState<McpPermissionSettings>(
    createPermissiveMcpSettings,
  );
  const [scopeTarget, setScopeTarget] = useState<ApiKeySummary | null>(null);
  const [scopeEnabled, setScopeEnabled] = useState(false);
  const [scopeDraft, setScopeDraft] = useState<McpPermissionSettings>(createPermissiveMcpSettings);

  useEffect(() => {
    if (!loaded && !loading) {
      void dispatch(loadApiKeys());
    }
  }, [dispatch, loaded, loading]);

  useEffect(() => {
    if (!sitesLoaded && !sitesLoading && !sitesError) {
      void dispatch(loadSites({}));
    }
  }, [dispatch, sitesError, sitesLoaded, sitesLoading]);

  const formatDate = (iso: string | null) => {
    if (!iso) return t('settings:apiKeys.never');
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  };

  const handleCreateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(true);
      return;
    }
    setNameError(false);
    dispatch(clearApiKeysMessages());
    void dispatch(
      createApiKey({
        name: parsed.data,
        ...(createScopesEnabled ? { scopes: toMcpPermissionSpec(createScopes) } : {}),
      }),
    );
  };

  // The reveal dialog replaces the create dialog the moment the key exists.
  useEffect(() => {
    if (createdKey) {
      setCreateOpen(false);
      setName('');
      setCreateScopesEnabled(false);
      setCreateScopes(createPermissiveMcpSettings());
    }
  }, [createdKey]);

  const handleRevealClose = () => {
    setCopied(false);
    dispatch(clearCreatedApiKey());
  };

  const handleCopy = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
  };

  const handleRevokeConfirm = (id: string) => {
    dispatch(clearApiKeysMessages());
    void dispatch(revokeApiKey({ id }));
    setRevokeTarget(null);
  };

  const openScopeEditor = (key: ApiKeySummary) => {
    dispatch(clearApiKeysMessages());
    setScopeTarget(key);
    setScopeEnabled(key.scopes !== null);
    setScopeDraft(materializeMcpSpec(key.scopes));
  };

  const handleScopeSave = async (target: ApiKeySummary) => {
    const action = await dispatch(
      updateApiKeyScopes({
        id: target.id,
        scopes: scopeEnabled ? toMcpPermissionSpec(scopeDraft) : null,
      }),
    );
    if (updateApiKeyScopes.fulfilled.match(action)) setScopeTarget(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl">{t('settings:apiKeys.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">{t('settings:apiKeys.description')}</p>
          <DocsLink slug="rankmefast-mcp" labelKey="docsLink.openGuide" />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            dispatch(clearApiKeysMessages());
            setNameError(false);
            setCreateScopesEnabled(false);
            setCreateScopes(createPermissiveMcpSettings());
            setCreateOpen(true);
          }}
        >
          <KeyRound data-icon="inline-start" />
          {t('settings:apiKeys.create')}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}
        {revokeError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{revokeError}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert role="status">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {loading && !loaded ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <Skeleton className="h-8 w-full" data-testid="api-keys-skeleton" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : keys.length === 0 && loaded && !loadError ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('settings:apiKeys.empty')}</EmptyTitle>
              <EmptyDescription>{t('settings:apiKeys.description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : keys.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings:apiKeys.name')}</TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('settings:apiKeys.prefix')}
                      description={t('common:tableHelp.apiKeyPrefix')}
                    />
                  </TableHead>
                  <TableHead>{t('settings:apiKeys.created')}</TableHead>
                  <TableHead>{t('settings:apiKeys.lastUsed')}</TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('settings:apiKeys.scopes.column')}
                      description={t('common:tableHelp.apiKeyScopes')}
                    />
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t('settings:apiKeys.revoke')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id} data-testid={`api-key-row-${key.id}`}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-muted-foreground text-xs">{key.prefix}…</code>
                    </TableCell>
                    <TableCell>{formatDate(key.createdAt)}</TableCell>
                    <TableCell>{formatDate(key.lastUsedAt)}</TableCell>
                    <TableCell>
                      {key.revokedAt ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={key.scopes ? 'secondary' : 'outline'}>
                            {key.scopes
                              ? t('settings:apiKeys.scopes.restricted')
                              : t('settings:apiKeys.scopes.unrestricted')}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openScopeEditor(key)}
                          >
                            <SlidersHorizontal data-icon="inline-start" />
                            {t('settings:apiKeys.scopes.edit')}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {key.revokedAt ? (
                        <Badge variant="outline">{t('settings:apiKeys.revokedBadge')}</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          loading={revokingId === key.id}
                          onClick={() => setRevokeTarget(key)}
                        >
                          {t('settings:apiKeys.revoke')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>

      {/* Create dialog */}
      {createOpen ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCreateOpen(false);
          }}
        >
          <DialogContent>
            <form onSubmit={handleCreateSubmit} noValidate>
              <DialogHeader>
                <DialogTitle>{t('settings:apiKeys.createTitle')}</DialogTitle>
                <DialogDescription>{t('settings:apiKeys.createDescription')}</DialogDescription>
              </DialogHeader>
              <FieldGroup className="py-4">
                <Field data-invalid={nameError || undefined}>
                  <FieldLabel htmlFor="api-key-name">{t('settings:apiKeys.name')}</FieldLabel>
                  <Input
                    id="api-key-name"
                    value={name}
                    maxLength={60}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={nameError || undefined}
                    aria-describedby={nameError ? 'api-key-name-error' : undefined}
                  />
                  {nameError ? (
                    <FieldError id="api-key-name-error">
                      {t('settings:apiKeys.errors.nameRequired')}
                    </FieldError>
                  ) : null}
                </Field>

                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="api-key-restrict-scopes">
                      {t('settings:apiKeys.scopes.restrictCreate')}
                    </FieldLabel>
                    <FieldDescription>
                      {t('settings:apiKeys.scopes.intersectionHint')}
                    </FieldDescription>
                  </FieldContent>
                  <Checkbox
                    id="api-key-restrict-scopes"
                    checked={createScopesEnabled}
                    disabled={creating}
                    onCheckedChange={(checked) => setCreateScopesEnabled(checked === true)}
                  />
                </Field>

                {createScopesEnabled ? (
                  <McpScopeFields
                    idPrefix="create-api-key"
                    value={createScopes}
                    sites={sites}
                    control="checkbox"
                    disabled={creating}
                    onChange={setCreateScopes}
                  />
                ) : null}

                {sitesError && createScopesEnabled ? (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{t('settings:apiKeys.scopes.sitesFailed')}</AlertDescription>
                  </Alert>
                ) : null}
                {createError ? <FieldError>{createError}</FieldError> : null}
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  {t('common:cancel')}
                </Button>
                <Button type="submit" loading={creating}>
                  {t('settings:apiKeys.create')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Show-once reveal dialog — closing it discards the key forever. */}
      {createdKey ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) handleRevealClose();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settings:apiKeys.showOnceTitle')}</DialogTitle>
              <DialogDescription>{t('settings:apiKeys.showOnceWarning')}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-2">
              <code
                className="bg-muted flex-1 overflow-x-auto rounded-md border border-border px-3 py-2 text-xs"
                data-testid="api-key-full"
              >
                {createdKey.key}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCopy(createdKey.key)}
                aria-label={t('settings:apiKeys.copy')}
              >
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? t('settings:apiKeys.copied') : t('settings:apiKeys.copy')}
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={handleRevealClose}>
                {t('settings:apiKeys.done')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Per-key scopes replace wholesale; disabling restrictions sends null. */}
      {scopeTarget ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && scopesSavingId === null) setScopeTarget(null);
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('settings:apiKeys.scopes.editTitle')}</DialogTitle>
              <DialogDescription>
                {t('settings:apiKeys.scopes.editDescription', {
                  name: scopeTarget.name,
                })}
              </DialogDescription>
            </DialogHeader>

            <FieldGroup className="py-2">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="api-key-custom-scopes">
                    {t('settings:apiKeys.scopes.restrictKey')}
                  </FieldLabel>
                  <FieldDescription>
                    {t('settings:apiKeys.scopes.intersectionHint')}
                  </FieldDescription>
                </FieldContent>
                <Checkbox
                  id="api-key-custom-scopes"
                  checked={scopeEnabled}
                  disabled={scopesSavingId === scopeTarget.id}
                  onCheckedChange={(checked) => setScopeEnabled(checked === true)}
                />
              </Field>

              {scopeEnabled ? (
                <McpScopeFields
                  idPrefix={`api-key-${scopeTarget.id}`}
                  value={scopeDraft}
                  sites={sites}
                  control="checkbox"
                  disabled={scopesSavingId === scopeTarget.id}
                  onChange={setScopeDraft}
                />
              ) : (
                <Alert>
                  <AlertDescription>
                    {t('settings:apiKeys.scopes.unrestrictedDescription')}
                  </AlertDescription>
                </Alert>
              )}

              {scopesError ? <FieldError>{scopesError}</FieldError> : null}
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={scopesSavingId === scopeTarget.id}
                onClick={() => setScopeTarget(null)}
              >
                {t('common:cancel')}
              </Button>
              <Button
                type="button"
                loading={scopesSavingId === scopeTarget.id}
                loadingLabel={t('settings:apiKeys.scopes.saving')}
                onClick={() => void handleScopeSave(scopeTarget)}
              >
                {t('settings:apiKeys.scopes.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Revoke confirm */}
      {revokeTarget ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setRevokeTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('settings:apiKeys.revokeConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('settings:apiKeys.revokeConfirmDescription', {
                  name: revokeTarget.name,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleRevokeConfirm(revokeTarget.id)}>
                {t('settings:apiKeys.revoke')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Card>
  );
};
