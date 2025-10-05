import type { Plugin } from "rollup";
import type { FilterPattern } from "@rollup/pluginutils";

import path from "node:path";
import glob from "fast-glob";
import { writeFile } from "node:fs/promises";
import { createFilter, normalizePath } from "@rollup/pluginutils";

import { projectDir } from "../shared/dir";

const ID_PREFIX = "glob:";
const root = path.join(projectDir, "server");
type GlobMap = Record<string /* name:pattern */, string[]>;

export function RollopGlob(): Plugin {
    const map: GlobMap = {};
    const include: FilterPattern = [];
    const exclude: FilterPattern = [];
    const filter = createFilter(include, exclude);
    return {
        name: "rollup-glob",
        resolveId(id, src) {
            if (!id.startsWith(ID_PREFIX)) return;
            if (!src || !filter(src)) return;

            // eslint-disable-next-line consistent-return
            return `${id}:${encodeURIComponent(src)}`;
        },
        async load(id) {
            if (!id.startsWith(ID_PREFIX)) return;

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [_, pattern, encodePath] = id.split(":");
            const currentPath = decodeURIComponent(encodePath);

            const files = (
                await glob(pattern, {
                    cwd: currentPath ? path.dirname(currentPath) : root,
                    absolute: true,
                })
            )
                .map((file) => normalizePath(file))
                .filter((file) => file !== normalizePath(currentPath))
                .sort();
            map[pattern] = files;

            const contents = files
                .map((file) => {
                    const r = file.replace("/index", "");
                    const name = path.basename(r, path.extname(r));
                    return `export * as ${name} from '${file}'\n`;
                })
                .join("\n");

            await writeTypeDeclaration(map, path.join(root, "glob"));

            // eslint-disable-next-line consistent-return
            return `${contents}\n`;
        },
    };
}

async function writeTypeDeclaration(map: GlobMap, filename: string) {
    function relatePath(filepath: string) {
        return normalizePath(path.relative(path.dirname(filename), filepath));
    }

    let declares = "/* eslint-disable */\n\n";

    const sortedEntries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));

    for (const [, [id, files]] of sortedEntries.entries()) {
        declares += `declare module '${ID_PREFIX}${id}' {\n`;
        for (const file of files) {
            const relative = `./${relatePath(file)}`.replace(/\.tsx?$/, "");
            const r = file.replace("/index", "");
            const fileName = path.basename(r, path.extname(r));
            declares += `  export const ${fileName}: typeof import('${relative}')\n`;
        }
        declares += "}\n";
    }
    await writeFile(`${filename}.d.ts`, declares, "utf-8");
}
