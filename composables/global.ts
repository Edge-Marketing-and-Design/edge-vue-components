// DO NOT EDIT

const route = useRoute()

const edgeState = reactive({
  currentOrganization: '',
  organizationDocPath: '',
  organizations: [],
  changeTracker: {},
  user: null,
  userRoles: [],
  lastPaginatedDoc: null,
  subscribedStatus: null,
  showLeftPanel: {} as Record<string, boolean>,
  menuItems: [],
  isAdminCollections: [] as string[],
  redirectRoute: '',
})

const setOrganization = async (organization: string, edgeFirebase: any) => {
  if (organization) {
    edgeState.changeTracker = {}
    localStorage.setItem('organizationID', organization)
    edgeState.currentOrganization = organization
    await edgeFirebase.startUsersSnapshot(`organizations/${organization}`)
    edgeState.organizationDocPath = `organizations/${organization}`
  }
}

const showLeftPanel = (show: boolean) => {
  edgeState.showLeftPanel[route.path] = show
}

const getSubscribedStatus = (org: any) => {
  let isSubscribed = true
  let status = ''
  let description = ''
  let color = ''
  let icon = ''

  if (!org || !org.stripeSubscription) {
    isSubscribed = false
    status = 'Not Subscribed'
    description = 'No subscription found.'
    color = 'bg-red-900'
    icon = 'AlertCircle'
  }
  else {
    const subscription = org.stripeSubscription

    if (!subscription || subscription === 'canceled') {
      isSubscribed = false
      status = 'Canceled'
      description = 'The subscription has been canceled.'
      color = 'bg-red-600'
      icon = 'X'
    }
    else {
      switch (subscription) {
        case 'trialing':
          status = 'Trial'
          description = 'The subscription is currently in a trial period.'
          color = 'bg-green-600'
          icon = 'Check'
          break
        case 'active':
          status = 'Active'
          description = 'The subscription is in good standing.'
          color = 'bg-green-600'
          icon = 'Check'
          break
        case 'incomplete':
          status = 'Incomplete'
          description = 'A successful payment needs to be made within 23 hours to activate the subscription.'
          color = 'bg-amber-500'
          icon = 'Hourglass'
          break
        case 'incomplete_expired':
          status = 'Incomplete Expired'
          description = 'The initial payment on the subscription failed and no successful payment was made within 23 hours of creating the subscription.'
          color = 'bg-red-600'
          icon = 'AlertCircle'
          break
        case 'past_due':
          status = 'Past Due'
          description = 'Payment on the latest finalized invoice either failed or wasn’t attempted.'
          color = 'bg-red-600'
          icon = 'AlertCircle'
          break
        case 'unpaid':
          status = 'Unpaid'
          description = 'The latest invoice hasn’t been paid but the subscription remains in place.'
          color = 'bg-red-600'
          icon = 'AlertCircle'
          break
        case 'paused':
          status = 'Paused'
          description = 'The subscription has ended its trial period without a default payment method.'
          color = 'bg-amber-500'
          icon = 'PauseCircle'
          break
        default:
          status = 'Unknown'
          description = 'The subscription status is unknown.'
          color = 'bg-red-600'
          icon = 'AlertCircle'
          break
      }
    }
  }

  return {
    isSubscribed,
    status,
    description,
    color,
    icon,
  }
}

const isDarkMode = () => {
  if (window.matchMedia) {
    const darkMode = window.matchMedia('(prefers-color-scheme: dark)')
    return darkMode.matches
  }
  return false
}

const generateShortId = () => {
  return Math.random().toString(36).substr(2, 6)
}

const objHas = (obj: any, key: string): boolean => {
  if (obj === null || obj === undefined) {
    return false
  }
  return Object.prototype.hasOwnProperty.call(obj, key)
}

const getOrganizations = async (edgeFirebase: any) => {
  console.log('getOrganizations')
  const orgs: any = []
  if (edgeFirebase.user.loggedIn) {
    for (const role of edgeFirebase.user.roles) {
      const segments = role.collectionPath.split('-')
      if (segments[0] === 'organizations') {
        await edgeFirebase.startDocumentSnapshot('organizations', segments[1])
        let org = await edgeFirebase.getDocData('organizations', segments[1])
        if (!org?.name) {
          org = { name: 'Organization', docId: segments[1] }
        }
        if (!orgs.some((o: { docId: string }) => o.docId === org.docId)) {
          orgs.push(org)
        }
      }
    }
  }
  edgeState.organizations = orgs
  console.log('Organizations:', edgeState.organizations)
}

const dupObject = (obj: any): any => {
  console.log('Duplicating object:', obj)
  return JSON.parse(JSON.stringify(obj))
}

const currentOrganizationObject = computed(() => {
  const edgeFirebase: any = inject('edgeFirebase')
  if (edgeState.organizations.length > 0) {
    if (edgeState.currentOrganization && edgeFirebase?.data[`organizations/${edgeState.currentOrganization}`]) {
      return edgeFirebase?.data[`organizations/${edgeState.currentOrganization}`]
    }
  }
  return ''
})

const edgeRules = {
  forms: (value: any) => {
    if (!value.length) {
      return 'You must setup at least one form.'
    }
    return true
  },
  submits: (value: any) => {
    if (!value.length) {
      return 'You must setup at least one submit.'
    }
    return true
  },
  gptFunctionName: (value: string) => {
    const pattern = /^[a-zA-Z0-9_-]{1,64}$/
    return pattern.test(value) || 'The function name must be 1-64 characters and can only contain letters, numbers, underscores, and dashes.'
  },
  endpoint: (value: string) => {
    const urlPattern = /^https?:\/\/(?!:\/\/)([a-zA-Z0-9]+\.)?[a-zA-Z0-9][a-zA-Z0-9-]+(\.[a-zA-Z]{2,6})?(:\d{1,5})?(\/[^\s]*)?$/i
    if (!urlPattern.test(value)) {
      return `"${value}" is not a valid URL. The URL must include the protocol (http or https) and the path.`
    }
    return true
  },
  domains: (value: string) => {
    const domainPattern = /^https?:\/\/(?!:\/\/)([a-zA-Z0-9]+\.)?[a-zA-Z0-9][a-zA-Z0-9-]+(\.[a-zA-Z]{2,6})?(:\d{1,5})?$/i
    const localhostPattern = /^https?:\/\/localhost(:\d{1,5})?$/i
    const ipAddressPattern = /^https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d{1,5})?$/
    const domains = value.split(',')
    for (const domain of domains) {
      if (
        !domainPattern.test(domain)
              && !localhostPattern.test(domain)
              && !ipAddressPattern.test(domain)
      ) {
        return `"${domain}" is not a valid domain or IP address. The domain or IP address must include the protocol (http or https).`
      }
    }
    return true
  },
  required: (value: any) => {
    if (typeof value === 'string' && !value) {
      return 'This field is required.'
    }
    else if (Array.isArray(value) && value.length === 0) {
      return 'This field is required.'
    }
    else if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) {
      return 'This field is required.'
    }
    else if (typeof value === 'boolean' && !value) {
      return 'This field is required.'
    }
    return true
  },
  email: (value: string) => {
    const pattern = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    return pattern.test(value) || 'Invalid e-mail.'
  },
  emailOrField: (value: string) => {
    const pattern = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    return pattern.test(value) || (value.startsWith('{{') && value.endsWith('}}')) || `Invalid e-mail or field. If you want to use a field, it must be wrapped in double curly braces, e.g. {{${value}}}`
  },
  toEmails: (value: string) => {
    const pattern = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    const emails = value.split(',')
    for (const email of emails) {
      if (!pattern.test(email)) {
        return `"${email}" is not a valid email address`
      }
    }
    return true
  },
  emailsOrFields: (value: string) => {
    const pattern = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    const emails = value.split(',')
    for (const email of emails) {
      if (!pattern.test(email) && !(email.startsWith('{{') && email.endsWith('}}'))) {
        return `"${email}" is not a valid email address or field. If you want to use a field, it must be wrapped in double curly braces, e.g. {{${email}}}`
      }
    }
    return true
  },
  password: (value: string) => {
    const pattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
    return pattern.test(value) || 'Password must have at least 8 characters, including uppercase and lowercase letters, numbers, and a special character'
  },
}

const edgeLogOut = async (edgeFirebase: any) => {
  edgeState.currentOrganization = ''
  edgeState.organizationDocPath = ''
  edgeState.organizations = []
  edgeState.changeTracker = {}
  edgeState.user = null
  nextTick(async () => {
    await edgeFirebase.logOut()
    window.location.reload()
  })
}

const orgUserRoles = (orgId: string) => {
  orgId = orgId.replaceAll('/', '-')
  const orgPath = `organizations-${orgId}`
  const newData = JSON.parse(JSON.stringify(edgeState.userRoles))

  for (let i = 0; i < newData.length; i++) {
    const roles = newData[i].roles
    for (let j = 0; j < roles.length; j++) {
      const role = roles[j]
      role.collectionPath = role.collectionPath.replace(/organizationDocPath/g, orgPath)
    }
  }

  return newData
}

interface UserRoleType {
  name: string
  roles: { collectionPath: string; role: string }[]
}

interface RoleType {
  collectionPath: string
  role: string
}

const getRoleName = (roles: RoleType[], orgId: string) => {
  const userRoles: UserRoleType[] = orgUserRoles(orgId)
  for (const user of userRoles) {
    let match = true
    for (const userRole of user.roles) {
      if (!roles.some(role => role.collectionPath === userRole.collectionPath && role.role === userRole.role)) {
        match = false
        break
      }
    }
    if (match) {
      return user.name
    }
  }
  return 'Unknown'
}

const isAdminGlobal = (edgeFirebase: any) => computed(() => {
  const roleCompares = dupObject(edgeState.isAdminCollections)
  roleCompares.push(`organizations-${edgeState.currentOrganization}`)
  console.log('roles compare')
  console.log(roleCompares)
  for (const compare of roleCompares) {
    const orgRole = edgeFirebase?.user?.roles.find((role: any) =>
      role.collectionPath === compare.replaceAll('/', '-'),
    )
    if (orgRole && orgRole.role === 'admin') {
      return true
    }
  }
  return false
})

interface MenuItem {
  to: string
  icon?: string
  submenu?: SubMenuItem[]
}

interface SubMenuItem {
  to: string
  icon?: string
}

interface BestMatch {
  icon: string
  len: number
}

const iconFromMenu = (route: { path: string }): string => {
  const normalize = (p: string): string => {
    if (!p)
      return '/'
    const cleaned = p.replace(/\/+$/, '')
    return cleaned.length ? cleaned : '/'
  }

  const current = normalize(route.path)
  let best: BestMatch = { icon: 'LayoutDashboard', len: -1 }

  for (const item of (edgeState.menuItems || []) as MenuItem[]) {
    const parentTo = normalize(item.to)

    // 1) Exact submenu match first (wins even if sub.to === item.to)
    if (Array.isArray(item.submenu)) {
      for (const sub of item.submenu) {
        const subTo = normalize(sub.to)
        if (subTo === current) {
          return sub.icon || item.icon || 'LayoutDashboard'
        }
        // Track most specific submenu prefix match
        if (current.startsWith(subTo) && subTo.length > best.len) {
          best = { icon: sub.icon || item.icon || 'LayoutDashboard', len: subTo.length }
        }
      }
    }

    // 2) Exact parent match (only if no exact submenu already returned)
    if (parentTo === current) {
      return item.icon || 'LayoutDashboard'
    }

    // 3) Track most specific parent prefix match
    if (current.startsWith(parentTo) && parentTo.length > best.len) {
      best = { icon: item.icon || 'LayoutDashboard', len: parentTo.length }
    }
  }

  // 4) Fallback
  return best.icon
}

export const edgeGlobal = {
  edgeState,
  setOrganization,
  getSubscribedStatus,
  isDarkMode,
  generateShortId,
  objHas,
  getOrganizations,
  dupObject,
  currentOrganizationObject,
  edgeRules,
  edgeLogOut,
  orgUserRoles,
  getRoleName,
  isAdminGlobal,
  iconFromMenu,
}
