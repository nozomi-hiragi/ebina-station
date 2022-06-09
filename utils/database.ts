import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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
