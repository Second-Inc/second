import * as React from "react"
import { cn } from "@/lib/utils"
import { balloons, textBalloons } from "balloons-js"

export interface BalloonsHandle {
  launchAnimation: () => void
}

export interface BalloonTextItem {
  text: string
  fontSize?: number
  color?: string
}

export interface BalloonsProps {
  type?: "default" | "text"
  text?: string
  texts?: BalloonTextItem[]
  fontSize?: number
  color?: string
  className?: string
  onLaunch?: () => void
}

const Balloons = React.forwardRef<BalloonsHandle, BalloonsProps>(
  ({ type = "default", text, texts, fontSize = 120, color = "#000000", className, onLaunch }, ref) => {
    const containerRef = React.useRef<HTMLDivElement>(null)

    const launchAnimation = React.useCallback(() => {
      if (type === "default") {
        balloons()
      } else if (type === "text") {
        if (texts && texts.length > 0) {
          textBalloons(
            texts.map((t) => ({
              text: t.text,
              fontSize: t.fontSize ?? fontSize,
              color: t.color ?? color,
            }))
          )
        } else if (text) {
          textBalloons([{ text, fontSize, color }])
        }
      }

      if (onLaunch) {
        onLaunch()
      }
    }, [type, text, texts, fontSize, color, onLaunch])

    React.useImperativeHandle(ref, () => ({
      launchAnimation,
    }), [launchAnimation])

    return <div ref={containerRef} className={cn("balloons-container", className)} />
  }
)
Balloons.displayName = "Balloons"

export { Balloons }
