import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { httpResource } from '@angular/common/http';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('frontend');
  protected readonly greeting = httpResource<{ message: string }>(() => '/api/hello');
}
