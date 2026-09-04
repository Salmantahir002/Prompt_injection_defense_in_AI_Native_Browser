import { Type, type Static } from '@sinclair/typebox'

// Matches FastAPI's HTTPException body: {"detail": "<message>"}. Shared by every
// route that returns a 4xx/5xx so the frontend's error handling stays unchanged.
export const ErrorResponseSchema = Type.Object({
  detail: Type.String(),
})

export type ErrorResponse = Static<typeof ErrorResponseSchema>
