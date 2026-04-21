import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { Folder } from '@models/collection';
import { HttpHeader, Script, AuthType } from '@models/request';
import { CollectionService } from '@core/collection.service';
import { TabItem } from '@core/tab.service';
import { CodeEditorComponent } from '../../shared/code-editor/code-editor.component';
import { VariableInputComponent } from '@shared-app/components/variable-input/variable-input.component';
import { EnvironmentsService } from '@core/environments.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown/dropdown.component';
import { cleanKv, pruneEmptyKv } from '@core/kv-utils';

export interface FolderVariable {
    key: string;
    value: string;
    description?: string;
    visible?: boolean;
}

@Component({
    selector: 'app-folder',
    standalone: true,
    imports: [CommonModule, FormsModule, CodeEditorComponent, VariableInputComponent, DropdownComponent],
    templateUrl: './folder.component.html',
    styleUrls: ['./folder.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FolderComponent implements OnInit, OnChanges, OnDestroy {
    @Input() tab!: TabItem;

    folder!: Folder;
    variables: FolderVariable[] = [];
    headers: HttpHeader[] = [];
    activeTab: 'variables' | 'headers' | 'scripts' | 'auth' | 'settings' = 'variables';
    activeVariables: Record<string, string> = {};

    authTypeOptions: DropdownOption[] = [
        { label: 'Inherit from parent', value: 'inherit' },
        { label: 'No Auth', value: 'none' },
        { label: 'Bearer Token', value: 'bearer' },
        { label: 'Basic Auth', value: 'basic' },
        { label: 'API Key', value: 'api_key' },
        { label: 'OAuth 2.0', value: 'oauth2' },
        { label: 'Digest Auth', value: 'digest' },
        { label: 'AWS Signature v4', value: 'aws_sigv4' },
        { label: 'Hawk', value: 'hawk' },
        { label: 'NTLM', value: 'ntlm' }
    ];

    apiKeyLocationOptions: DropdownOption[] = [
        { label: 'Header', value: 'header' },
        { label: 'Query Params', value: 'query' }
    ];

    oauthGrantTypeOptions: DropdownOption[] = [
        { label: 'Authorization Code', value: 'authorization_code' },
        { label: 'Client Credentials', value: 'client_credentials' }
    ];

    private destroy$ = new Subject<void>();
    /**
     * Suppression flag for the self-triggered reload loop:
     * `saveFolder` → `updateFolder` → `getFolderUpdatedObservable.next(...)`
     * → our own subscription → `loadFolder()` → would wipe in-progress blank
     * editor rows. We set this immediately before any save we initiate and
     * clear it the next time the observable fires.
     */
    private suppressNextReload = false;

    constructor(
        private collectionService: CollectionService,
        private environmentsService: EnvironmentsService,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit() {
        this.loadFolder();

        this.environmentsService.getActiveContextAsObservable()
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => {
                this.updateActiveVariables();
                this.cdr.markForCheck();
            });

        this.collectionService.getFolderUpdatedObservable()
            .pipe(takeUntil(this.destroy$))
            .subscribe(updatedFolder => {
                if (updatedFolder.id !== this.tab.id) return;
                if (this.suppressNextReload) {
                    this.suppressNextReload = false;
                    return;
                }
                this.loadFolder();
            });
    }

    ngOnChanges(changes: SimpleChanges) {
        const tabChange = changes['tab'];
        const prevId = tabChange?.previousValue?.id;
        const newId = tabChange?.currentValue?.id ?? this.tab?.id;
        if (tabChange && !tabChange.firstChange && prevId === newId) {
            return;
        }
        this.loadFolder();
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private loadFolder() {
        const folder = this.collectionService.findFolderById(this.tab.id);
        if (folder) {
            this.folder = JSON.parse(JSON.stringify(folder)); 
            const vars = this.folder.variables || [];
            this.variables = vars.map(v => ({ ...v, visible: false }));

            if (!this.folder.httpHeaders) this.folder.httpHeaders = [];
            this.headers = [...(this.folder.httpHeaders || [])];

            if (!this.folder.script) this.folder.script = { preRequest: '', postRequest: '' };
            if (!this.folder.auth) this.folder.auth = { type: AuthType.INHERIT };
            if (!this.folder.settings) this.folder.settings = { followRedirects: true, verifySsl: true, useCookies: true };

            this.updateActiveVariables();
            this.cdr.markForCheck();
        }
    }

    onAuthTypeChange() {
        if (this.folder.auth) {
            if (this.folder.auth.type === AuthType.BEARER && !this.folder.auth.bearer) {
                this.folder.auth.bearer = { token: '' };
            } else if (this.folder.auth.type === AuthType.BASIC && !this.folder.auth.basic) {
                this.folder.auth.basic = { username: '', password: '' };
            } else if (this.folder.auth.type === AuthType.API_KEY && !this.folder.auth.apiKey) {
                this.folder.auth.apiKey = { key: '', value: '', addTo: 'header' };
            } else if (this.folder.auth.type === AuthType.OAUTH2 && !this.folder.auth.oauth2) {
                this.folder.auth.oauth2 = { grantType: 'authorization_code' };
            }
        }
        this.saveFolder();
        this.cdr.markForCheck();
    }

    private updateActiveVariables() {
        this.activeVariables = {};

        const parents = this.collectionService.getParentFolders(this.tab.id);

        parents.reverse().forEach(folder => {
            cleanKv(folder.variables).forEach(v => {
                this.activeVariables[v.key as string] = v.value as string;
            });
        });

        const activeEnv = this.environmentsService.getActiveContext();
        cleanKv(activeEnv?.variables).forEach(v => {
            this.activeVariables[v.key as string] = v.value as string;
        });
    }

    saveFolder() {
        this.folder.variables = this.variables.map(({ visible, ...v }) => v);
        this.folder.httpHeaders = [...this.headers];

        const sanitized: Folder = {
            ...this.folder,
            variables: pruneEmptyKv(this.folder.variables),
            httpHeaders: pruneEmptyKv(this.folder.httpHeaders)
        };

        this.suppressNextReload = true;
        this.collectionService.updateFolder(sanitized);
        this.updateActiveVariables();
        this.cdr.markForCheck();
    }

    async fetchOAuth2Token() {
        const auth = this.folder.auth?.oauth2;
        if (!auth) return;

        if (auth.grantType === 'authorization_code') {
            if (!auth.authUrl || !auth.accessTokenUrl || !auth.clientId) {
                console.warn('OAuth2 configuration incomplete for authorization_code');
                return;
            }
        } else if (auth.grantType === 'client_credentials') {
            if (!auth.accessTokenUrl || !auth.clientId || !auth.clientSecret) {
                console.warn('OAuth2 configuration incomplete for client_credentials');
                return;
            }
        }

        try {
            if (auth.grantType === 'authorization_code') {
                const redirectUri = 'http://127.0.0.1:4200/oauth/callback';
                const authUrl = this.replaceVariables(auth.authUrl || '');
                const clientId = this.replaceVariables(auth.clientId || '');
                const scope = this.replaceVariables(auth.scope || '');

                const authRes = await window.awElectron.getOAuth2Token({
                    authUrl,
                    clientId,
                    redirectUri,
                    scope
                });

                if (authRes && authRes.code) {
                    const tokenUrl = this.replaceVariables(auth.accessTokenUrl || '');
                    const clientSecret = this.replaceVariables(auth.clientSecret || '');

                    const tokenRes = await window.awElectron.exchangeOAuth2Code({
                        tokenUrl,
                        code: authRes.code,
                        clientId,
                        clientSecret,
                        redirectUri
                    });

                    const accessToken = tokenRes?.['access_token'];
                    if (tokenRes && typeof accessToken === 'string' && accessToken) {
                        auth.accessToken = accessToken;
                        this.saveFolder();
                        this.cdr.markForCheck();
                    }
                }
            } else if (auth.grantType === 'client_credentials') {
                const tokenUrl = this.replaceVariables(auth.accessTokenUrl || '');
                const clientId = this.replaceVariables(auth.clientId || '');
                const clientSecret = this.replaceVariables(auth.clientSecret || '');
                const scope = this.replaceVariables(auth.scope || '');

                const tokenRes = await window.awElectron.getOAuth2ClientCredentials({
                    tokenUrl,
                    clientId,
                    clientSecret,
                    scope
                });

                const clientCredToken = tokenRes?.['access_token'];
                if (tokenRes && typeof clientCredToken === 'string' && clientCredToken) {
                    auth.accessToken = clientCredToken;
                    this.saveFolder();
                    this.cdr.markForCheck();
                }
            }
        } catch (err) {
            console.error('OAuth Error:', err);
        }
    }

    private replaceVariables(text: string): string {
        if (!text) return '';
        return text.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => {
            return this.activeVariables[key] !== undefined ? this.activeVariables[key] : match;
        });
    }

    addVariable() {
        this.variables.push({ key: '', value: '', description: '', visible: false });
        this.saveFolder();
    }

    removeVariable(index: number) {
        this.variables.splice(index, 1);
        this.saveFolder();
    }

    toggleVisibility(index: number) {
        this.variables[index].visible = !this.variables[index].visible;
        this.cdr.markForCheck();
    }

    addHeader() {
        this.headers.push({ key: '', value: '', description: '' });
        this.saveFolder();
    }

    removeHeader(index: number) {
        this.headers.splice(index, 1);
        this.saveFolder();
    }

    updatePreRequest(code: string) {
        this.folder.script!.preRequest = code;
        this.saveFolder();
    }

    updatePostRequest(code: string) {
        this.folder.script!.postRequest = code;
        this.saveFolder();
    }

    trackByIndex(index: number) {
        return index;
    }
}

