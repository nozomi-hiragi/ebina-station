import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// users table

export const createUser = (id: string, name: string, pass: string) => {
  return prisma.user.create({ data: { id, name, pass } })
}

export const findUser = (id: string) => {
  return prisma.user.findFirst({
    where: { id },
    select: { id: true, name: true, updated_at: true, created_at: true }
  })
}

export const getUsers = () => {
  return prisma.user.findMany({
    select: { id: true, name: true, updated_at: true, created_at: true }
  })
}

export const findUserWithPass = (id: string) => {
  return prisma.user.findFirst({ where: { id } })
}

export const deleteUsers = (ids: string[]) => {
  return prisma.user.deleteMany({ where: { id: { in: ids } } })
}

// tokens table

export const replaceRefreshToken = (id: string, token: string) => {
  return prisma.token.upsert({
    create: { id, refresh_token: token },
    update: { refresh_token: token },
    where: { id }
  })
}

export const findRefreshTokenFronTokenTable = (id: string) => {
  return prisma.token.findFirst({ where: { id } })
}

export const deleteRefreshToken = (id: string) => {
  return prisma.token.delete({ where: { id } })
}

// api

export const setAPI = (path: string, name: string, type: string, value: string) => {
  return prisma.api.create({ data: { path, name, type, value } })
}

export const updateAPI = (path: string, name: string, type: string, value: string) => {
  return prisma.api.update({ where: { path }, data: { name, type, value } })
}

export const getAPIs = () => {
  return prisma.api.findMany()
}

export const getAPI = (path: string) => {
  return prisma.api.findFirst({ where: { path } })
}

export const deleteAPI = (path: string) => {
  return prisma.api.delete({ where: { path } })
}
