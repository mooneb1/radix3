import type {
  RadixRouterContext,
  RadixNode,
  MatchedRoute,
  RadixRouter,
  RadixNodeData,
  RadixRouterOptions,
} from "./types";
import { NODE_TYPES } from "./types";

export function createRouter<T extends RadixNodeData = RadixNodeData>(
  options: RadixRouterOptions = {}
): RadixRouter<T> {
  const ctx: RadixRouterContext = {
    options,
    rootNode: createRadixNode(),
    staticRoutesMap: {},
  };

  const normalizeTrailingSlash = (p) =>
    options.strictTrailingSlash ? p : p.replace(/\/$/, "") || "/";

  if (options.routes) {
    for (const path in options.routes) {
      insert(ctx, normalizeTrailingSlash(path), options.routes[path]);
    }
  }

  return {
    ctx,
    // @ts-ignore
    lookup: (path: string) => lookup(ctx, normalizeTrailingSlash(path)),
    insert: (path: string, data: any) =>
      insert(ctx, normalizeTrailingSlash(path), data),
    remove: (path: string) => remove(ctx, normalizeTrailingSlash(path)),
  };
}

function lookup(ctx: RadixRouterContext, path: string): MatchedRoute {
  const staticPathNode = ctx.staticRoutesMap[path];
  if (staticPathNode) {
    return staticPathNode.data;
  }

  const sections = path.split("/");

  const params: MatchedRoute["params"] = {};
  let paramsFound = false;
  let wildcardNode = null;
  let node = ctx.rootNode;
  let wildCardParam = null;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    if (node.wildcardChildNode !== null) {
      wildcardNode = node.wildcardChildNode;
      wildCardParam = sections.slice(i).join("/");
    }

    // Exact matches take precedence over placeholders
    const nextNode = node.children.get(section);
    if (nextNode !== undefined) {
      node = nextNode;
    } else {
      node = node.placeholderChildNode;
      if (node !== null) {
        params[node.paramName] = section;
        paramsFound = true;
      } else {
        break;
      }
    }
  }

  if ((node === null || node.data === null) && wildcardNode !== null) {
    node = wildcardNode;
    params[node.paramName || "_"] = wildCardParam;
    paramsFound = true;
  }

  if (!node) {
    return null;
  }

  if (paramsFound) {
    return {
      ...node.data,
      params: paramsFound ? params : undefined,
    };
  }

  return node.data;
}

function insert(ctx: RadixRouterContext, path: string, data: any) {
  let isStaticRoute = true;

  const sections = path.split("/");

  let node = ctx.rootNode;

  let _unnamedPlaceholderCtr = 0;

  for (const section of sections) {
    let childNode: RadixNode<RadixNodeData>;

    if ((childNode = node.children.get(section))) {
      node = childNode;
    } else {
      const type = getNodeType(section);

      // Create new node to represent the next part of the path
      childNode = createRadixNode({ type, parent: node });

      node.children.set(section, childNode);

      if (type === NODE_TYPES.PLACEHOLDER) {
        if (section === "*") {
          childNode.paramName = `_${_unnamedPlaceholderCtr++}`;
        } else {
          const PARAMS_RE = /:\w+|[^:]+/g;
          const params = [...section.matchAll(PARAMS_RE)].map((i) => i[0]);
          if (params.length === 1) {
            childNode.paramName = params[0].slice(1);
          } else {
            childNode.type = NODE_TYPES.MIXED;
            childNode.mixedParams = params.map((p) =>
              p[0] === ":"
                ? { type: "dynamic", name: p.slice(1) }
                : { type: "static", name: p }
            );
          }
        }
        node.placeholderChildNode = childNode;
        isStaticRoute = false;
      } else if (type === NODE_TYPES.WILDCARD) {
        node.wildcardChildNode = childNode;
        childNode.paramName = section.slice(3 /* "**:" */) || "_";
        isStaticRoute = false;
      }

      node = childNode;
    }
  }

  // Store whatever data was provided into the node
  node.data = data;

  // Optimization, if a route is static and does not have any
  // variable sections, we can store it into a map for faster retrievals
  if (isStaticRoute === true) {
    ctx.staticRoutesMap[path] = node;
  }

  return node;
}

function remove(ctx: RadixRouterContext, path: string) {
  let success = false;
  const sections = path.split("/");
  let node = ctx.rootNode;

  for (const section of sections) {
    node = node.children.get(section);
    if (!node) {
      return success;
    }
  }

  if (node.data) {
    const lastSection = sections[sections.length - 1];
    node.data = null;
    if (Object.keys(node.children).length === 0) {
      const parentNode = node.parent;
      parentNode.children.delete(lastSection);
      parentNode.wildcardChildNode = null;
      parentNode.placeholderChildNode = null;
    }
    success = true;
  }

  return success;
}

function createRadixNode(options: Partial<RadixNode> = {}): RadixNode {
  return {
    type: options.type || NODE_TYPES.NORMAL,
    parent: options.parent || null,
    children: new Map(),
    data: options.data || null,
    paramName: options.paramName || null,
    wildcardChildNode: null,
    placeholderChildNode: null,
  };
}

function getNodeType(str: string) {
  if (str.startsWith("**")) {
    return NODE_TYPES.WILDCARD;
  }
  if (str.includes(":") || str === "*") {
    return NODE_TYPES.PLACEHOLDER;
  }
  return NODE_TYPES.NORMAL;
}
