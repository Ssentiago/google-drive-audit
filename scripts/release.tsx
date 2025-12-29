import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import semver from 'semver';
import TOML from '@iarna/toml';

const PACKAGE_JSON = 'package.json';
const CARGO_TOML = 'src-tauri/Cargo.toml';
const TAURI_CONF = 'src-tauri/tauri.conf.json';
const MAIN_BRANCHES = ['main', 'master'];

let isDryRun = false;

function logAction(action: string, details?: string) {
    const prefix = isDryRun ? chalk.blue('[DRY RUN]') : chalk.green('[EXEC]');
    console.log(`${prefix} ${action}${details ? `: ${details}` : ''}`);
}

function execCommand(command: string, options: any = {}) {
    if (isDryRun) {
        logAction('Would execute', command);
        return '';
    }
    return execSync(command, options);
}

function checkGhCli() {
    try {
        execSync('gh --version', { stdio: 'ignore' });
    } catch (error) {
        console.error(
            chalk.red(
                'Github Cli (GH) was not found. Install it: https://cli.github.com/'
            )
        );
        process.exit(1);
    }
}

async function changeVersionInJson(
    jsonPath: string,
    version: string,
    jsonKeyPath: string[]
) {
    try {
        const json = fs.readFileSync(jsonPath, 'utf8');
        const data = JSON.parse(json);
        let current = data;
        for (let i = 0; i < jsonKeyPath.length - 1; i++) {
            current = current[jsonKeyPath[i]];
        }
        current[jsonKeyPath[jsonKeyPath.length - 1]] = version;

        const formatted = await prettier.format(JSON.stringify(data), {
            parser: 'json',
        });

        if (isDryRun) {
            logAction(`Would update ${jsonPath}`, `version: ${version}`);
        } else {
            fs.writeFileSync(jsonPath, formatted);
        }
    } catch (err: any) {
        console.error('Error updating JSON file:', err);
        process.exit(1);
    }
}

async function changeVersionInToml(tomlPath: string, version: string) {
    try {
        const tomlContent = fs.readFileSync(tomlPath, 'utf8');
        const data = TOML.parse(tomlContent);
        data.package.version = version;

        const formatted = TOML.stringify(data);

        if (isDryRun) {
            logAction(`Would update ${tomlPath}`, `version: ${version}`);
        } else {
            fs.writeFileSync(tomlPath, formatted);
        }
    } catch (err: any) {
        console.error('Error updating TOML file:', err);
        process.exit(1);
    }
}

async function performGitOperations(version: string, branch: string) {
    try {
        execCommand('git reset', { stdio: 'ignore' });
        execCommand(`git add ${PACKAGE_JSON} ${TAURI_CONF} ${CARGO_TOML}`, {
            stdio: 'ignore',
        });
        execCommand(`git commit -m "chore: update version to ${version}"`, {
            stdio: 'ignore',
        });
        execCommand(`git push origin ${branch}`, { stdio: 'ignore' });

        if (!isDryRun) {
            console.log(chalk.green('Changes pushed to repo'));
        }
    } catch (error) {
        if (!isDryRun) {
            console.error('Git operations error:', error);
            process.exit(1);
        }
    }
}

async function createAndPushTag(version: string) {
    logAction('Creating and pushing git tag', version);

    if (isDryRun) {
        logAction('Would create and push tag', `v${version}`);
        return;
    }

    try {
        execCommand(`git tag ${version}`, { stdio: 'inherit' });
        execCommand(`git push origin ${version}`, { stdio: 'inherit' });
        console.log(chalk.green(`Tag ${version} created and pushed`));
    } catch (error) {
        console.error('Tag creation error:', error);
        process.exit(1);
    }
}

async function getNewVersion(
    previousVersions: string[],
    currentVersion: string,
    isFirstEnter: boolean
) {
    const answer = await input({
        message: 'Enter new version number or press Enter to exit: ',
        required: false,
        validate: (value) => {
            if (value === '') {
                return true;
            }
            if (!semver.valid(value)) {
                return 'Invalid version format. Please try again. It should be semantic versioning (e.g., 1.2.3)';
            }
            if (previousVersions.includes(value)) {
                return 'Version already exists. Please try again.';
            }
            if (!isFirstEnter && semver.lt(value, currentVersion)) {
                return `Version must be greater than current version. Current version is: ${currentVersion}. Please try again.`;
            }
            return true;
        },
    });

    if (!answer.trim()) {
        console.log('See you later!');
        process.exit(0);
    }

    return answer;
}

async function versionMenu(
    previousVersions: string[],
    currentVersion: string
): Promise<string> {
    process.on('SIGINT', () => {
        console.log('\nProcess terminated. Exiting gracefully...');
        process.exit(0);
    });

    while (true) {
        const [major, minor, patch] = currentVersion.split('.').map(Number);

        const answer = await select({
            message: `Update current version ${currentVersion} or perform other actions:`,
            choices: [
                {
                    name: `Patch (bug fixes): ${major}.${minor}.${patch + 1}`,
                    value: '1',
                },
                {
                    name: `Minor (new functionality): ${major}.${minor + 1}.0`,
                    value: '2',
                },
                {
                    name: `Major (significant changes): ${major + 1}.0.0`,
                    value: '3',
                },
                { name: 'Manual update (enter version)', value: '4' },
                { name: 'View previous versions', value: '5' },
                { name: 'Exit', value: '6' },
            ],
        });

        if (answer === '1') {
            return `${major}.${minor}.${patch + 1}`;
        } else if (answer === '2') {
            return `${major}.${minor + 1}.0`;
        } else if (answer === '3') {
            return `${major + 1}.0.0`;
        } else if (answer === '4') {
            return getNewVersion(previousVersions, currentVersion, false);
        } else if (answer === '5') {
            console.log('Previous versions:');
            console.log(`- ${previousVersions.join('\n- ')}`);
            await input({
                message: 'Press Enter to go back to the menu...',
                required: false,
                transformer: () => '',
            });
        } else if (answer === '6') {
            console.log('See you later!');
            process.exit(0);
        }
    }
}

async function getVersion(): Promise<{
    version: string;
    previousVersion: string;
}> {
    const tagOutput = execSync('git tag', { stdio: 'pipe' }).toString().trim();
    const tags = tagOutput ? tagOutput.split('\n') : [];
    const currentVersion = tags[tags.length - 1] || '0.0.0';

    if (tags.length === 0) {
        const version = await getNewVersion(tags, currentVersion, true);
        return { version, previousVersion: '' };
    }

    const version = await versionMenu(tags, currentVersion);
    return { version, previousVersion: currentVersion };
}

function checkAllFilesExist() {
    const files = [PACKAGE_JSON, TAURI_CONF, CARGO_TOML];
    const nonExistingFiles = files.filter((f) => !fs.existsSync(f));

    if (nonExistingFiles.length > 0) {
        console.log(chalk.red(`Missing files: ${nonExistingFiles.join(', ')}`));
        return false;
    }
    return true;
}

export async function release(isDryRunOption: boolean): Promise<void> {
    isDryRun = isDryRunOption;

    checkGhCli();

    const allFilesExist = checkAllFilesExist();
    if (!allFilesExist) {
        process.exit(1);
    }

    while (true) {
        const { version: RELEASE_VERSION, previousVersion } =
            await getVersion();

        const confirmation = await select({
            message: `You entered version ${RELEASE_VERSION}. Continue?`,
            choices: [
                { name: 'Yes', value: 'y' },
                { name: 'No', value: 'n' },
                { name: 'Retry', value: 'r' },
            ],
        });

        switch (confirmation) {
            case 'y':
                break;
            case 'n':
                console.log('See you later!');
                process.exit(0);
            case 'r':
                continue;
        }

        await changeVersionInJson(PACKAGE_JSON, RELEASE_VERSION, ['version']);
        await changeVersionInJson(TAURI_CONF, RELEASE_VERSION, ['version']);
        await changeVersionInToml(CARGO_TOML, RELEASE_VERSION);

        if (isDryRun) {
            console.log(
                chalk.blue(
                    `[DRY RUN] Version would be updated to ${RELEASE_VERSION} in files`
                )
            );
        } else {
            console.log(
                chalk.green(`Version updated to ${RELEASE_VERSION} in files`)
            );
        }

        if (!isDryRun) {
            const confirmContinue = await confirm({
                message: 'Continue with git operations and tag push?',
                default: true,
            });

            if (!confirmContinue) {
                console.log('See you later!');
                process.exit(0);
            }
        }

        const currentBranch = isDryRun
            ? 'main'
            : execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' })
                  .toString()
                  .trim();

        console.log(`Working with branch: ${currentBranch}`);

        if (!MAIN_BRANCHES.includes(currentBranch)) {
            console.log(
                chalk.red(
                    `Expected one of branches: ${MAIN_BRANCHES.join(', ')}, got: ${currentBranch}`
                )
            );
            if (!isDryRun) {
                process.exit(1);
            }
        }

        await performGitOperations(RELEASE_VERSION, currentBranch);

        await createAndPushTag(RELEASE_VERSION);

        if (isDryRun) {
            console.log(
                chalk.blue(
                    `🔍 DRY RUN COMPLETE: Version ${RELEASE_VERSION} would be updated and tagged!`
                )
            );
        } else {
            console.log(
                chalk.green(
                    `Version ${RELEASE_VERSION} updated and tagged! Actions will handle build/release.`
                )
            );
        }

        break;
    }
}

const dryRun = process.argv.includes('--dry-run');
release(dryRun);
