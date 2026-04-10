import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

const authInterceptor = (req: any, next: any) => {
  try {
    const raw = localStorage.getItem('currentUser');
    if (raw) {
      const parsed = JSON.parse(raw);
      const token = parsed?.token;
      if (token) {
        return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
      }
    }
  } catch {
    localStorage.removeItem('currentUser');
  }
  return next(req);
};

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimations(),
    provideHttpClient(withInterceptors([authInterceptor]))
  ]
}).catch((err) => console.error(err));
