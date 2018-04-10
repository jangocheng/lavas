/**
 * @file DevBuilder
 * @author lavas
 */

import {emptyDir, outputFile, copy, remove, readFileSync} from 'fs-extra';
import {join} from 'path';

import {copyWorkboxLibraries} from 'workbox-build';
import glob from 'glob';

import {CONFIG_FILE, ASSETS_DIRNAME_IN_DIST} from '../constants';
import {webpackCompile} from '../utils/webpack';
import {distLavasPath} from '../utils/path';

import BaseBuilder from './base-builder';

export default class ProdBuilder extends BaseBuilder {
    constructor(core) {
        super(core);
        this.writeFile = outputFile;
    }

    /**
     * build in production mode
     */
    async build() {
        let {build, globals, entries: entriesConfig, serviceWorker} = this.config;

        if (build.ssr && entriesConfig.length !== 0) {
            throw new Error('[Lavas] Multi Entries cannot use SSR mode. Try to set ssr to `false`');
            return;
        }

        // clear dist/ first
        await emptyDir(build.path);

        if (serviceWorker.enable !== false) {
            // empty previous version
            let workboxDirs = glob.sync(join(this.cwd, ASSETS_DIRNAME_IN_DIST, 'workbox-v*'));
            if (workboxDirs.length !== 0) {
                await Promise.all(workboxDirs.map(async dir => await remove(dir)));
            }
            // copy current version
            await copyWorkboxLibraries(join(this.cwd, ASSETS_DIRNAME_IN_DIST));
        }

        await this.routeManager.buildRoutes();

        let writeTasks = [
            this.writeRuntimeConfig(),
            this.writeMiddleware(),
            this.writeStore()
        ];

        if (entriesConfig.length !== 0) {
            writeTasks.push(this.writeLavasLink());
        }

        await Promise.all(writeTasks);

        // SSR build process
        if (build.ssr) {
            console.log('[Lavas] SSR build starting...');
            // webpack client & server config
            let clientConfig = this.webpackConfig.client();
            let serverConfig = this.webpackConfig.server();

            // build bundle renderer
            await this.renderer.build(clientConfig, serverConfig);

            /**
             * when running online server, renderer needs to use template and
             * replace some variables such as meta, config in it. so we need
             * to store some props in config.json.
             * NOTE: not all the props in config is needed. for now, only manifest
             * & assetsDir are required. some props such as globalDir are useless.
             */
            await copy(
                this.lavasPath(CONFIG_FILE),
                distLavasPath(build.path, CONFIG_FILE)
            );

            /**
             * Don't use copy-webpack-plugin to copy this kind of files,
             * otherwise these files will be added in the compilation of webpack.
             * It will let some plugins such as vue-ssr-client misuse them.
             * So just use fs.copy in such senario.
             */
            if (build.ssrCopy) {
                await Promise.all(build.ssrCopy.map(
                    async ({src, dest = src, options = {}}) => {
                        await copy(
                            join(globals.rootDir, src),
                            join(build.path, dest),
                            options
                        );
                    }
                ));
            }
            console.log('[Lavas] SSR build completed.');
        }
        // SPA build process
        else {
            let mode = entriesConfig.length === 0 ? 'SPA' : 'MPA';
            console.log(`[Lavas] ${mode} build starting...`);
            await webpackCompile(await this.createSPAConfig(false, mode === 'SPA'));
            console.log(`[Lavas] ${mode} build completed.`);
        }
    }
}