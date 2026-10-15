import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Preview page for the drawer (#467). The component has no production call
// site yet, so this route is how the styling gets reviewed against the Figma
// spec and against the BCDS modal it has to match. Remove it once a real
// screen uses the drawer.

const directions = ['right', 'left', 'bottom', 'top'] as const;
const sizes = ['sm', 'md', 'lg'] as const;

export function DrawerDemo() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Drawer</h1>
        <p className="text-muted-foreground">
          Open one and compare it against the invite dialog on a tenant&apos;s
          Users tab — they should read as the same family.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">Direction</h2>
        <div className="flex flex-wrap gap-2">
          {directions.map((direction) => (
            <Drawer key={direction} direction={direction}>
              <DrawerTrigger asChild>
                <Button variant="outline">{direction}</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Invite user</DrawerTitle>
                  <DrawerDescription>
                    Opens from the {direction}.
                  </DrawerDescription>
                </DrawerHeader>
                <DrawerBody>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`email-${direction}`}>
                      Email (required)
                    </Label>
                    <Input
                      id={`email-${direction}`}
                      placeholder="person@example.com"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No invitation email is sent yet. Ask them to sign in with
                    this email address to accept.
                  </p>
                </DrawerBody>
                <DrawerFooter>
                  <DrawerClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </DrawerClose>
                  <Button>Invite</Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">Width</h2>
        <div className="flex flex-wrap gap-2">
          {sizes.map((size) => (
            <Drawer key={size} direction="right">
              <DrawerTrigger asChild>
                <Button variant="outline">{size}</Button>
              </DrawerTrigger>
              <DrawerContent size={size}>
                <DrawerHeader>
                  <DrawerTitle>Width: {size}</DrawerTitle>
                  <DrawerDescription>
                    sm 24rem · md 32rem (default) · lg 42rem
                  </DrawerDescription>
                </DrawerHeader>
                <DrawerBody>
                  <p className="text-sm">
                    Long content scrolls here while the header and footer stay
                    put.
                  </p>
                </DrawerBody>
                <DrawerFooter>
                  <DrawerClose asChild>
                    <Button variant="secondary">Close</Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-start gap-3">
        <h2 className="font-bold">No close button</h2>
        <Drawer direction="right">
          <DrawerTrigger asChild>
            <Button variant="outline">Deliberate dismissal</Button>
          </DrawerTrigger>
          <DrawerContent showCloseButton={false}>
            <DrawerHeader>
              <DrawerTitle>Confirm something</DrawerTitle>
              <DrawerDescription>
                No X in the corner — the footer owns dismissal.
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <p className="text-sm">Escape and the scrim still close it.</p>
            </DrawerBody>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DrawerClose>
              <Button variant="destructive">Delete</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </section>
    </div>
  );
}
