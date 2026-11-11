import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button, EmptyState } from '../components/ui'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="surface">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="The page you were looking for may have moved, or the link is incomplete."
          action={
            <Link to="/dashboard">
              <Button>Back to dashboard</Button>
            </Link>
          }
        />
      </div>
    </div>
  )
}
