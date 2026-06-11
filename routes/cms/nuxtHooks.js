import { resolve as resolvePath } from 'node:path'
import { cmsRoutes } from './routes'

const resolveRouteFileFromCwd = (file) => {
  const normalizedPath = String(file || '').replace(/^\.\//, '')
  return resolvePath(process.cwd(), normalizedPath)
}

export const createCmsNuxtHooks = (resolveFile) => {
  const resolveRouteFile = typeof resolveFile === 'function'
    ? resolveFile
    : resolveRouteFileFromCwd

  const routeExists = (routeList, name) => {
    for (const route of routeList) {
      if (route.name === name)
        return true
      if (route.children?.length && routeExists(route.children, name))
        return true
    }
    return false
  }

  const resolveCmsRoute = (route, appRootRoute, isChild = false) => {
    const shouldStripAppPrefix = Boolean(appRootRoute) && !isChild
    const nextRoute = {
      ...route,
      path: shouldStripAppPrefix
        ? route.path.replace(/^\/app\/?/, '')
        : route.path,
      file: resolveRouteFile(route.file),
    }

    if (route.children?.length)
      nextRoute.children = route.children.map(child => resolveCmsRoute(child, appRootRoute, true))

    return nextRoute
  }

  return {
    'pages:extend': (pages) => {
      const appRootRoute = pages.find(page => page.path === '/app')

      cmsRoutes.forEach((route) => {
        const isAppRoute = String(route.path || '').startsWith('/app')
        const targetRoutes = isAppRoute && appRootRoute?.children ? appRootRoute.children : pages
        const routeToAdd = resolveCmsRoute(route, isAppRoute ? appRootRoute : null)
        if (!routeExists(targetRoutes, routeToAdd.name))
          targetRoutes.push(routeToAdd)
      })
    },
  }
}
