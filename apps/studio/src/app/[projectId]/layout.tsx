"use client"

import { use } from "react"
import { notFound } from "next/navigation"
import { getProject } from "@repo/schema/projects"
import { ProjectProvider } from "@/lib/project-context"

export default function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ projectId: string }>
  children: React.ReactNode
}) {
  const { projectId } = use(params)
  const project = getProject(projectId)
  if (!project) return notFound()
  return <ProjectProvider project={project}>{children}</ProjectProvider>
}
