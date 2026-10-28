import * as vscode from 'vscode';
import { AddonWorkspaceFolder } from './addon_folder';

// Wait for a burst of changes (git checkout, formatter, external editor) to settle before reloading.
const RELOAD_DELAY_MS = 300;

type ReloadAddons = (addons: AddonWorkspaceFolder[]) => Promise<void>;

/**
 * Watches the source directory of every addon with `blender.addon.reloadOnChange` enabled
 * and reloads it in Blender when files change on disk, including changes made outside of VS Code.
 */
export function registerReloadOnChange(reloadAddons: ReloadAddons): vscode.Disposable[] {
    let watchers: vscode.Disposable[] = [];
    let pending = new Map<string, AddonWorkspaceFolder>();
    let timer: NodeJS.Timeout | undefined;

    const scheduleReload = (addon: AddonWorkspaceFolder) => {
        pending.set(addon.uri.toString(), addon);
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            const addons = [...pending.values()];
            pending.clear();
            void reloadAddons(addons);
        }, RELOAD_DELAY_MS);
    };

    const updateWatchers = async () => {
        watchers.forEach(w => w.dispose());
        watchers = [];
        for (const addon of await AddonWorkspaceFolder.All()) {
            if (!addon.reloadOnChange) continue;
            const sourceDir = await addon.getSourceDirectory();
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(sourceDir, '**/*.{py,toml}'));
            watcher.onDidChange(() => scheduleReload(addon));
            watcher.onDidCreate(() => scheduleReload(addon));
            watcher.onDidDelete(() => scheduleReload(addon));
            watchers.push(watcher);
        }
    };

    void updateWatchers();

    return [
        vscode.workspace.onDidChangeWorkspaceFolders(() => void updateWatchers()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('blender.addon') || event.affectsConfiguration('blender.addonFolders')) {
                void updateWatchers();
            }
        }),
        { dispose: () => {
            if (timer !== undefined) clearTimeout(timer);
            watchers.forEach(w => w.dispose());
        } },
    ];
}
