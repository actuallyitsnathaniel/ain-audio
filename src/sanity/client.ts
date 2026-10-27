import {createClient} from '@sanity/client'
import {apiVersion, assertSanityEnv, dataset, projectId} from './env'

assertSanityEnv()

export const client = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: true,
})
