"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configs = exports.unload = exports.load = void 0;
const load = function () {
    console.debug(`${PACKAGE_NAME} load`);
};
exports.load = load;
const unload = function () {
    console.debug(`${PACKAGE_NAME} unload`);
};
exports.unload = unload;
const PACKAGE_NAME = 'hot_update';
exports.configs = {
    'android': {
        hooks: './hooks',
        doc: 'editor/publish/custom-build-plugin.html',
        options: {
            version: {
                label: `version`,
                default: '1.0.1',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '需要根据当前版本号迭代来填写，测试期间可以按默认值的格式填写',
                    },
                },
                verifyRules: ['required'],
            },
            remoteManifestUrl: {
                label: `remoteManifestUrl`,
                default: '',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '远端的资源更新服务器',
                    },
                },
                verifyRules: [],
            }
        },
    },
    'ios': {
        hooks: './hooks',
        doc: 'editor/publish/custom-build-plugin.html',
        options: {
            version: {
                label: `version`,
                default: '1.0.1',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '需要根据当前版本号迭代来填写，测试期间可以按默认值的格式填写',
                    },
                },
                verifyRules: ['required'],
            },
            remoteManifestUrl: {
                label: `remoteManifestUrl`,
                default: '',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '远端的资源更新服务器',
                    },
                },
                verifyRules: [],
            }
        },
    },
};
