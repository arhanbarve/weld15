import DesktopOnly from "@/ui/DesktopOnly";
import CanvasHost from "@/scene/CanvasHost";

export default function Page() {
  // The gate wraps the whole app rather than sitting over it, so a phone never
  // mounts the canvas at all -- an overlay would still have started WebGL,
  // downloaded three.js and run the camera underneath the message.
  return (
    <DesktopOnly>
      <main>
        <CanvasHost />
      </main>
    </DesktopOnly>
  );
}
