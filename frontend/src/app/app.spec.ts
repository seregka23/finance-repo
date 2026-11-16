import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('requests the NestJS greeting on page load and displays the response', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    TestBed.tick();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.textContent).toContain('Connecting to the backend');
    expect(page.querySelector('button')?.disabled).toBe(true);
    const request = http.expectOne('/api/hello');
    expect(request.request.method).toBe('GET');
    request.flush({ message: 'A message from the API' });
    await fixture.whenStable();

    expect(page.querySelector('h1')?.textContent).toContain('Hello, frontend');
    expect(page.querySelector('[role="status"]')?.textContent).toContain('A message from the API');
    expect(page.querySelector('button')?.disabled).toBe(false);
  });

  it('shows an error and retries the request when the user clicks Try again', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('/api/hello').flush('Unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('[role="status"]')?.textContent).toContain('Could not reach the backend');
    const button = page.querySelector('button')!;
    expect(button.textContent).toContain('Try again');

    button.click();
    TestBed.tick();
    expect(button.disabled).toBe(true);
    http.expectOne('/api/hello').flush({ message: 'Connection restored' });
    await fixture.whenStable();

    expect(page.querySelector('[role="status"]')?.textContent).toContain('Connection restored');
    expect(button.textContent).toContain('Refresh response');
  });
});
