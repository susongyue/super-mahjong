"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAfterBuild = exports.onBeforeCompressSettings = void 0;
const { exec } = require(`child_process`);
'use strict';
var fs = require("fs");
var path = require("path");
var inject_script = `
(function () {
    if (typeof window.jsb === 'object') {
        var hotUpdateSearchPaths = localStorage.getItem('HotUpdateSearchPaths');
        if (hotUpdateSearchPaths) {
            var paths = JSON.parse(hotUpdateSearchPaths);
            jsb.fileUtils.setSearchPaths(paths);

            var fileList = [];
            var storagePath = paths[0] || '';
            var tempPath = storagePath + '_temp/';
            var baseOffset = tempPath.length;

            if (jsb.fileUtils.isDirectoryExist(tempPath) && !jsb.fileUtils.isFileExist(tempPath + 'project.manifest.temp')) {
                jsb.fileUtils.listFilesRecursively(tempPath, fileList);
                fileList.forEach(srcPath => {
                    var relativePath = srcPath.substr(baseOffset);
                    var dstPath = storagePath + relativePath;

                    if (srcPath[srcPath.length] == '/') {
                        jsb.fileUtils.createDirectory(dstPath)
                    }
                    else {
                        if (jsb.fileUtils.isFileExist(dstPath)) {
                            jsb.fileUtils.removeFile(dstPath)
                        }
                        jsb.fileUtils.renameFile(srcPath, dstPath);
                    }
                })
                jsb.fileUtils.removeDirectory(tempPath);
            }
        }
    }
})();
`;
const onBeforeCompressSettings = function (options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        if (options.packages[`hot_update`]) {
            let { remoteManifestUrl, version } = options.packages[`hot_update`];
            let resdir = 'assets';

            if (fs.existsSync(path.join(result.dest, 'data'))) {
                resdir = 'data';
            }

            let cmd = `node version_generator.js -v ${version} -u ${remoteManifestUrl} -s ${path.join(result.dest, resdir)} -d ${path.join(Editor.Project.path, "assets")}`
            console.warn("执行版本打包命令:", cmd);

            exec(cmd, { cwd: Editor.Project.path }, (err, stdout, stderr) => {
                if (!err) return;
                console.error(err);
            });

        }
    });
};
exports.onBeforeCompressSettings = onBeforeCompressSettings;
const onAfterBuild = function (options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        //更改资源查找路径
        var url = path.join(result.dest, 'data', 'main.js');
        if (!fs.existsSync(url)) {
            url = path.join(result.dest, 'assets', 'main.js');
        }
        fs.readFile(url, "utf8", function (err, data) {
            if (err) {
                throw err;
            }
            var newStr = inject_script + data;
            fs.writeFile(url, newStr, function (error) {
                if (err) {
                    throw err;
                }
                console.warn("SearchPath updated in built main.js for hot update");
            });
        });
    });
};
exports.onAfterBuild = onAfterBuild;
