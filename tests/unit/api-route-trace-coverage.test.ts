import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const API_ROOT = path.resolve(process.cwd(), "app/api");
const EXEMPT_ROUTE_PREFIXES = ["app/api/diagnostics/"];

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectRouteFiles(entryPath);
    }
    return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
  });
}

function toProjectPath(filePath: string) {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function isExemptRoute(projectPath: string) {
  return EXEMPT_ROUTE_PREFIXES.some((prefix) => projectPath.startsWith(prefix));
}

function hasExportModifier(node: ts.Node) {
  return ts.canHaveModifiers(node)
    ? (ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

function findExportedHandlers(source: string, filePath: string) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  return sourceFile.statements.flatMap((statement) => {
    if (!hasExportModifier(statement)) {
      return [];
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const method = HTTP_METHODS.find(
        (candidate) => candidate === statement.name?.text
      );
      return method ? [{ method, wrapped: false }] : [];
    }

    if (!ts.isVariableStatement(statement)) {
      return [];
    }

    return statement.declarationList.declarations.flatMap((declaration) => {
      if (!ts.isIdentifier(declaration.name)) {
        return [];
      }
      const handlerName = declaration.name.text;
      const method = HTTP_METHODS.find(
        (candidate) => candidate === handlerName
      );
      if (!method) {
        return [];
      }
      const initializer = declaration.initializer;
      const wrapped =
        !!initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === "withTracedApiHandler";
      return [{ method, wrapped }];
    });
  });
}

describe("API route trace coverage", () => {
  it("wraps every non-exempt route handler with withTracedApiHandler", () => {
    const missingCoverage = collectRouteFiles(API_ROOT).flatMap((filePath) => {
      const projectPath = toProjectPath(filePath);
      if (isExemptRoute(projectPath)) {
        return [];
      }

      const source = readFileSync(filePath, "utf8");
      const exportedHandlers = findExportedHandlers(source, filePath);
      if (exportedHandlers.length === 0) {
        return [];
      }

      return exportedHandlers.flatMap(({ method, wrapped }) =>
        wrapped ? [] : [`${projectPath} ${method}`]
      );
    });

    expect(missingCoverage).toEqual([]);
  });
});
