import { Magazine as BaseMagazine, Flipbook } from '@edgedev/edgecomponents'

export const Magazine = {
  ...BaseMagazine,
  components: {
    ...(BaseMagazine.components || {}),
    'edge-flipbook': Flipbook,
  },
}
