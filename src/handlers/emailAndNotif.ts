import { Entity, entities } from '../Entities'
import log from '../helpers/logger'
import { getAccessToken, getUserId } from '../helpers/storage'
import { axios, formatUserSessionOptions } from '../helpers/synapse'
import lineByLine from 'n-readlines'

import { RcUser } from '../handlers/users'

export type ThreepidsData = {
  threepids: {
    medium: string
    address: string
  }[]
}

export type EmailPusher = {
  kind: string
  app_id: string
  pushkey: string
  app_display_name: string
  device_display_name: string
  lang: string
  append: string
  data: {
    brand: string
  }
}

const defaultEmailPusher: EmailPusher = {
  kind: 'email',
  app_id: 'm.email',
  pushkey: '',
  app_display_name: 'Email Notifications',
  device_display_name: '',
  lang: 'en',
  append: 'true',
  data: {
    brand: 'IM',
  },
}

/**
 * Add email to a user account on the Synapse server
 * @param user The RC user to register, including the nonce and hmac
 * @returns The new user's session's access token
 */
async function addEmail(email: string, matrixId: string): Promise<void> {
  const threepidsData: ThreepidsData = {
    threepids: [
      {
        medium: 'email',
        address: email,
      },
    ],
  }
  await axios.put('/_synapse/admin/v2/users/' + matrixId, threepidsData)
}

/**
 * Add a pusher email to a user account on the Synapse server
 * @param user The RC user to register, including the nonce and hmac
 * @returns The new user's session's access token
 */
async function addPusherEmail(userToken: string, email: string): Promise<void> {
  const userSessionOptions = formatUserSessionOptions(userToken)
  const userEmailPusher: EmailPusher = {
    ...defaultEmailPusher,
    pushkey: email,
    device_display_name: email,
  }
  log.debug(userEmailPusher)
  await axios.post(
    '/_matrix/client/v3/pushers/set',
    userEmailPusher,
    userSessionOptions
  )
}

/**
 * Check, map, parse and possibly add email to its account and a pusher to receive email notifications
 * @param rcUser The RC user to handle
 */
export async function handle(entity: Entity): Promise<void> {
  const rl = new lineByLine(`./inputs/${entities[entity].filename}`)
  let line: false | Buffer
  while ((line = rl.next())) {
    const rcUser: RcUser = JSON.parse(line.toString())
    log.info(`Parsing user: ${rcUser.name}: ${rcUser._id}`)
    const matrixId = await getUserId(rcUser._id)
    const userToken = await getAccessToken(rcUser._id)
    if (matrixId && userToken && rcUser.emails) {
      if (rcUser.emails[0]) {
        const email = rcUser.emails[0].address
        await addEmail(email, matrixId)
        await addPusherEmail(userToken, email)
      } else {
        log.debug(rcUser.emails)
      }
    } else {
      log.debug(`User : ${rcUser._id}, is not registered / mapped in base`)
    }
  }
}