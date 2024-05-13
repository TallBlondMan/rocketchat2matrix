import dotenv from 'dotenv'
dotenv.config()
import { AxiosError } from 'axios'
import lineByLine from 'n-readlines'
import 'reflect-metadata'
import { Entity, entities } from './Entities'
import { handleDirectChats } from './handlers/directChats'
import { handlePinnedMessages } from './handlers/pinnedMessages'
import { handle as handleMessage } from './handlers/messages'
import { getFilteredMembers, handle as handleRoom } from './handlers/rooms'
import { handle as handleEmailNotif } from './handlers/emailAndNotif'
import { handle as handleUser } from './handlers/users'
import log from './helpers/logger'
import {
  getAllMappingsByType,
  getMappingByMatrixId,
  getMemberships,
  initStorage,
} from './helpers/storage'
import {
  axios,
  formatUserSessionOptions,
  getMatrixMembers,
  whoami,
} from './helpers/synapse'
import { exit } from 'node:process'

log.info('rocketchat2matrix starts.')

/**
 * Reads a file line by line and handles the lines parsed to JSON according to the expected type
 * @param entity The Entity with it's file name and type definitions
 */
async function loadRcExport(entity: Entity) {
  const rl = new lineByLine(`./inputs/${entities[entity].filename}`)

  let line: false | Buffer
  while ((line = rl.next())) {
    const item = JSON.parse(line.toString())
    switch (entity) {
      case Entity.Users:
        await handleUser(item)
        break

      case Entity.Rooms:
        await handleRoom(item)
        break

      case Entity.Messages:
        await handleMessage(item)
        break

      default:
        throw new Error(`Unhandled Entity: ${entity}`)
    }
  }
}

/**
 * Remove all excess Matrix room members, which are not part of the Rocket.Chat room and not an admin
 * This had issue with no error reporting - fixed now
 */
async function removeExcessRoomMembers() {
  try {
    const roomMappings = await getAllMappingsByType(entities[Entity.Rooms].mappingType)
    if (!roomMappings) {
      throw new Error(`No room mappings found`)
    }

    await Promise.all(roomMappings.map(async (roomMapping) => {
      try {
        log.info(`Checking memberships for room ${roomMapping.rcId} / ${roomMapping.matrixId}`)
        const rcMemberIds = await getMemberships(roomMapping.rcId)
        const memberMappings = await getFilteredMembers(rcMemberIds, '')
        const memberNames: string[] = memberMappings.map((memberMapping) => memberMapping.matrixId || '')

        const actualMembers: string[] = await getMatrixMembers(roomMapping.matrixId || '')

        await Promise.all(actualMembers.map(async (actualMember) => {
          try {
            const adminUsername = process.env.ADMIN_USERNAME || ''
            if (!memberNames.includes(actualMember) && !actualMember.includes(adminUsername)) {
              log.warn(`Member ${actualMember} should not be in room ${roomMapping.matrixId}, removing`)
              const memberMapping = await getMappingByMatrixId(actualMember)
              if (!memberMapping || !memberMapping.accessToken) {
                throw new Error(`Could not find access token for member ${actualMember}, this is a bug`)
              }

              await axios.post(`/_matrix/client/v3/rooms/${roomMapping.matrixId}/leave`, {}, formatUserSessionOptions(memberMapping.accessToken))
            }
          } catch (error) {
            if (error instanceof AxiosError) {
              log.error(`Error while processing member: ${error.message}`)
              log.error(`Request: ${error.request?.method} ${error.request?.path}`)
              log.error(`Response: ${error.response?.status}`, error.response?.data)
            } else {
              console.error(`Error while processing member ${actualMember}:`, error)
            }
          }
        }))
      } catch (error) {
        if (error instanceof AxiosError) {
          log.error(`Error while processing room: ${error.message}`)
          log.error(`Request: ${error.request?.method} ${error.request?.path}`)
          log.error(`Response: ${error.response?.status}`, error.response?.data)
        } else {
          console.error(`Error while processing room ${roomMapping.matrixId}:`, error)
        }
      }
    }))
  } catch (error) {
    log.warn('An error occurred:', error)
  }
}

async function main() {
  try {
    await whoami()
    await initStorage()

    log.info('Parsing users')
    await loadRcExport(Entity.Users)
    log.info('Parsing rooms')
    await loadRcExport(Entity.Rooms)
    log.info('Parsing messages')
    // Disabled because of long time to process - should be used when migrating!!!
    //await loadRcExport(Entity.Messages)
    log.info('Setting direct chats to be displayed as such for each user')
    await handleDirectChats()
    log.info('Setting pinned messages in rooms')
    await handlePinnedMessages()
    log.info('Checking room memberships')
    await removeExcessRoomMembers()
    // Need to be at the bottom
    // So to not send emails to users while migrating
    log.info('Setting email in user account and an email pusher')
    await handleEmailNotif(Entity.Users)

    log.info('Done.')
  } catch (error) {
    if (error instanceof AxiosError) {
      log.error(`Error during request: ${error.message}`)
      log.error(`Request: ${error.request?.method} ${error.request?.path}`)
      log.error(`Response: ${error.response?.status}`, error.response?.data)
    } else {
      log.error(`Encountered an error while booting up: ${error}`, error)
    }
    exit(1)
  }
}

main()
